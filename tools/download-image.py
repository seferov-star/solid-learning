import sys,zipfile,hashlib
from pathlib import Path
from github import session
s=session();base='https://api.github.com/repos/seferov-star/solid-learning';r=s.get(base+'/actions/runs/'+sys.argv[1]+'/artifacts',timeout=30);r.raise_for_status();a=next(a for a in r.json()['artifacts'] if a['name']=='api-image');dest=Path(sys.argv[2]);dest.parent.mkdir(exist_ok=True,parents=True)
r=s.get(a['archive_download_url'],timeout=180);r.raise_for_status()
archive=dest.with_suffix('.zip');archive.write_bytes(r.content)
with zipfile.ZipFile(archive) as z:dest.write_bytes(z.read('api-image.tar.gz'))
print(hashlib.sha256(dest.read_bytes()).hexdigest(),dest)
