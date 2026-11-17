import io
import json
import tarfile
import pytest
from ingestion.expansion_sources import directory,candidate,winget_row


def archived(files):
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w:gz') as archive:
        for path,body in files.items():
            data=body.encode();info=tarfile.TarInfo(path);info.size=len(data);archive.addfile(info,io.BytesIO(data))
    stream.seek(0);return stream


def test_winget_versions_merge_to_one_product_and_installers_are_never_read():
    def row(version,name='Actual'):
        return f'ManifestType: defaultLocale\nPackageLocale: en-US\nPackageIdentifier: Example.Actual\nPackageVersion: {version}\nPackageName: {name}\nPackageUrl: https://actual.dev\nShortDescription: A useful application for testing.\n'
    files={'repo/manifests/a/Actual/1.9/Actual.locale.en-US.yaml':row('1.9','Old name'),'repo/manifests/a/Actual/1.10/Actual.locale.en-US.yaml':row('1.10'),'repo/installer.ps1':'DO NOT EXECUTE'}
    result=directory('winget',archived(files))
    assert len(result)==1 and result[0]['name']=='Actual'
    assert result[0]['source_url'].endswith('/1.10/Actual.locale.en-US.yaml')
    assert 'capabilities' not in result[0]


def test_source_metadata_cannot_execute_yaml_tags_or_scoop_scripts():
    files={'repo/bucket/actual.json':json.dumps({'homepage':'https://actual.dev','description':'Useful independent software.','pre_install':'rm -rf /','version':'1.0'}),'repo/bucket/actual-nightly.json':json.dumps({'homepage':'https://actual.dev/nightly','description':'Nightly duplicate.'})}
    result=directory('scoop-extras',archived(files))
    assert len(result)==1 and 'pre_install' not in result[0]
    assert directory('winget',archived({'repo/x.locale.en-US.yaml':'!!python/object/apply:os.system [echo unsafe]'}))==[]


@pytest.mark.parametrize('name,url,description',[('Runtime SDK','https://sdk.dev','A runtime development kit.'),('Actual','http://actual.dev','A useful product.'),('Actual','https://127.0.0.1','A useful product.'),('Actual','https://microsoft.com','A useful product.'),('Actual','https://softsea.com/software/Actual.html','A useful product.')])
def test_dependencies_and_unsafe_or_generic_homepages_are_excluded(name,url,description):
    assert candidate(name,url,description,'Source','https://source.dev','id') is None
