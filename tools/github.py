import subprocess,requests

def session():
 p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
 d=dict(l.split('=',1) for l in p.stdout.splitlines() if '=' in l)
 s=requests.Session();s.headers.update({'Authorization':'Bearer '+d['password'],'Accept':'application/vnd.github+json'});return s
if __name__=='__main__':
 import sys
 s=session();base='https://api.github.com/repos/seferov-star/solid-learning'
 if sys.argv[1]=='rerun':print(s.post(base+'/actions/runs/'+sys.argv[2]+'/rerun',timeout=30).status_code)
 elif sys.argv[1]=='status':
  r=s.get(base+'/actions/runs?per_page=1',timeout=30).json();print([(a['id'],a['head_sha'][:7],a['status'],a['conclusion']) for a in r.get('workflow_runs',[])])
