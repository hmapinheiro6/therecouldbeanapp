"""HTTPS fetcher: public DNS only, pinned connection, verified TLS, bounded redirects/body."""
import http.client
import ipaddress
import socket
import ssl
import time
from urllib.parse import urlsplit, urlunsplit, urljoin, parse_qsl, urlencode
from urllib.robotparser import RobotFileParser

USER_AGENT = 'ThereCouldBeAnAppBot/1.0 (+https://therecouldbeanapp.henriquepinheiro.workers.dev/about)'
MAX_BYTES = 2097152

class UnsafeURL(ValueError):
    pass
class FetchError(RuntimeError):
    def __init__(self, reason, temporary=True):
        super().__init__(reason)
        self.temporary = temporary

def canonicalize(value, keep_www=False):
    u = urlsplit(value)
    host = (u.hostname or '').lower()
    if host.startswith('www.') and not keep_www: host=host[4:]
    if u.scheme != 'https' or u.username or u.password or u.port or not host or '.' not in host:
        raise UnsafeURL('Public HTTPS URLs without credentials or custom ports only')
    if host.endswith(('.local', '.internal', '.localhost', '.test', '.invalid', '.example', '.onion')) or host == 'localhost':
        raise UnsafeURL('Reserved hostname')
    try:
        ip = ipaddress.ip_address(host)
        # IP literals have no editorial product identity and are excluded entirely.
        raise UnsafeURL('IP literal is not a product website: '+str(ip))
    except ValueError as e:
        if isinstance(e, UnsafeURL):
            raise
    query = urlencode(sorted((k,v) for k,v in parse_qsl(u.query, keep_blank_values=True) if not k.startswith('utm_') and k not in ('ref','fbclid','gclid')))
    path = '/' + '/'.join(s for s in u.path.split('/') if s)
    return urlunsplit(('https',host,(u.path or '/') if keep_www else path.rstrip('/'),query,''))

def resolve_public(host):
    try:
        addresses = sorted(set(info[4][0] for info in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)), key=lambda address: (ipaddress.ip_address(address).version, address))
    except OSError as e:
        raise FetchError('DNS resolution failed') from e
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise UnsafeURL('Private, reserved, or mixed public/private DNS destination')
    return addresses

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, hostname, address, timeout=10):
        super().__init__(hostname,timeout=timeout,context=ssl.create_default_context())
        self.address = address
    def connect(self):
        self.sock = socket.create_connection((self.address,443),self.timeout)
        self.sock = self._context.wrap_socket(self.sock,server_hostname=self.host)

class SafeWeb:
    def __init__(self, delay=1.0, max_pages=3):
        self.delay=delay
        self.max_pages=min(max_pages,3)
        self.robots={}
        self.last_request={}
        self.pages={}
    def _raw(self, url, redirects=0, attempt=0):
        url=canonicalize(url, keep_www=True)
        host=urlsplit(url).hostname
        addresses=resolve_public(host)
        wait=self.delay-(time.monotonic()-self.last_request.get(host,0))
        if wait>0: time.sleep(wait)
        connection=PinnedHTTPS(host,addresses[0])
        u=urlsplit(url)
        try:
            connection.request('GET',urlunsplit(('', '',u.path or '/',u.query,'')),headers={'Host':host,'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml,application/json,application/xml,text/plain','Accept-Encoding':'identity'})
            self.last_request[host]=time.monotonic()
            r=connection.getresponse()
            if r.status in (301,302,303,307,308):
                if redirects>=3: raise FetchError('Redirect limit reached',False)
                destination=canonicalize(urljoin(url,r.getheader('Location','')), keep_www=True)
                # Redirects are validated and checked against the destination robots policy.
                if not urlsplit(destination).path.endswith('/robots.txt') and not self.allowed(destination):
                    raise FetchError('Redirect destination denied by robots.txt',False)
                return self._raw(destination,redirects+1)
            if r.status in (429,500,502,503,504):
                if attempt<1:
                    retry=r.getheader('Retry-After','2')
                    time.sleep(min(int(retry) if retry.isdigit() else 2,8))
                    return self._raw(url,redirects,attempt+1)
                raise FetchError('Temporary HTTP '+str(r.status))
            if r.status in (401,403): raise FetchError('Access restricted (no bypass attempted)',False)
            if r.status==404: return {'url':url,'status':404,'text':'','content_type':r.getheader('Content-Type','')}
            if r.status!=200: raise FetchError('HTTP '+str(r.status),r.status>=500)
            declared=r.getheader('Content-Length')
            if declared and int(declared)>MAX_BYTES: raise FetchError('Response exceeds size limit',False)
            payload=r.read(MAX_BYTES+1)
            if len(payload)>MAX_BYTES: raise FetchError('Response exceeds size limit',False)
            return {'url':url,'status':r.status,'text':payload.decode('utf-8',errors='replace'),'content_type':r.getheader('Content-Type','')}
        except (OSError,ssl.SSLError,http.client.HTTPException) as e:
            if attempt<1:
                time.sleep(2)
                return self._raw(url,redirects,attempt+1)
            raise FetchError('Network or TLS failure') from e
        finally:
            connection.close()
    def allowed(self,url):
        u=urlsplit(canonicalize(url, keep_www=True));base='https://'+u.hostname
        if base not in self.robots:
            # Deny while fetching to prevent robots redirect recursion loops.
            self.robots[base]=False
            response=self._raw(base+'/robots.txt')
            if response['status']==404:
                self.robots[base]=True
            else:
                parser=RobotFileParser();parser.parse(response['text'].splitlines());self.robots[base]=parser
        policy=self.robots[base]
        return policy if isinstance(policy,bool) else policy.can_fetch(USER_AGENT,url)
    def fetch(self,url):
        url=canonicalize(url, keep_www=True);host=urlsplit(url).hostname
        if self.pages.get(host,0)>=self.max_pages: raise FetchError('Per-domain content page budget reached',False)
        if not self.allowed(url): raise FetchError('robots.txt disallows access',False)
        self.pages[host]=self.pages.get(host,0)+1
        return self._raw(url)
