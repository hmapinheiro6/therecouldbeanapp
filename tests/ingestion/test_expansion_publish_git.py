"""Reproduce a queued stale checkout without any network or production mutation."""
import json,os,subprocess
from pathlib import Path


def test_publication_refreshes_a_stale_checkout_before_committing_generated_json(tmp_path):
    script=Path('scripts/publish-expansion.mjs').resolve()
    origin=tmp_path/'origin.git';writer=tmp_path/'writer';queued=tmp_path/'queued'
    def git(cwd,*args):
        return subprocess.run(['git',*args],cwd=cwd,check=True,capture_output=True,text=True).stdout
    git(tmp_path,'init','--bare',str(origin));git(tmp_path,'clone',str(origin),str(writer));git(writer,'switch','-c','main')
    git(writer,'config','user.name','Fixture');git(writer,'config','user.email','fixture@example.invalid')
    (writer/'data/seeds').mkdir(parents=True);(writer/'public').mkdir()
    (writer/'data/expansion-health.json').write_text('{"published":1}\n');(writer/'data/seeds/published-snapshot.json').write_text('{"products":[]}\n')
    git(writer,'add','.');git(writer,'commit','-m','baseline');git(writer,'push','-u','origin','main')
    git(tmp_path,'clone','--branch','main',str(origin),str(queued))
    (writer/'data/expansion-health.json').write_text('{"published":2}\n');(writer/'source.txt').write_text('new source revision\n')
    git(writer,'add','.');git(writer,'commit','-m','another batch and source update');git(writer,'push','origin','main')
    (queued/'data/expansion-health.json').write_text('{"published":3}\n')
    env={**os.environ,'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'hmapinheiro6/therecouldbeanapp','GH_TOKEN':'isolated-dummy-token-not-a-credential'}
    result=subprocess.run(['node',str(script)],cwd=queued,env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    git(writer,'fetch','origin','main')
    assert json.loads(git(writer,'show','origin/main:data/expansion-health.json'))['published']==3
    assert git(writer,'show','origin/main:source.txt')=='new source revision\n'
    assert 'isolated-dummy-token' not in result.stdout+result.stderr
    assert subprocess.run(['node',str(script)],cwd=queued,env=env,capture_output=True).returncode==0
