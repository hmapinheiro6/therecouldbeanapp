"""Fail closed before bulk work when account-wide provider usage is stale or >=70%."""
import json
import os
from pathlib import Path
from .client import InternalClient

def ready(client=None):
    result=(client or InternalClient()).request('/api/internal/budget')
    if not isinstance(result,dict) or not isinstance(result.get('allowed'),bool):
        raise ValueError('Invalid account budget response')
    print(json.dumps({'job_budget':result,'note':'Provider query usage is logged separately'}))
    output=os.environ.get('GITHUB_OUTPUT')
    if output:
        with Path(output).open('a') as stream:stream.write('ready='+str(result['allowed']).lower()+'\n')
    return result['allowed']

if __name__=='__main__':ready()
