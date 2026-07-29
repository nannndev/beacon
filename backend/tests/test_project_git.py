import subprocess
import tempfile
import unittest
from pathlib import Path

from backend.app.services.project_file_sync import ProjectFileSyncService
from backend.app.services.project_git import ProjectGitError, ProjectGitService


def run_git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=True).stdout.strip()


def project(project_id="project-1"):
    return {
        "id": project_id,
        "name": "Git Project",
        "current_environment_id": "env-1",
        "environments": [{"id": "env-1", "name": "Local", "base_url": "https://example.com", "variables": {"api_token": "secret"}}],
        "items": [{"type": "request", "id": "endpoint-1", "name": "Health", "method": "GET", "url": "/health"}],
    }


class ProjectGitServiceTests(unittest.TestCase):
    def setUp(self):
        self.files = ProjectFileSyncService()
        self.git = ProjectGitService()

    def configure_identity(self, root: Path):
        run_git(root, "config", "user.name", "Beacon Tests")
        run_git(root, "config", "user.email", "beacon@example.test")

    def test_init_commit_excludes_private_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)

            initialized = self.git.init(source)
            self.assertTrue(initialized["repository"])
            self.assertEqual(initialized["branch"], "main")
            self.configure_identity(root)
            committed = self.git.commit(source, "Add Beacon project")

            self.assertEqual(committed["changes"], [])
            tracked = run_git(root, "ls-files").splitlines()
            self.assertIn("beacon.yaml", tracked)
            self.assertNotIn(".beacon/environments.local.yaml", tracked)
            self.assertIn(".beacon/", (root / ".gitignore").read_text())

    def test_push_and_fast_forward_pull_with_local_bare_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "first"
            root.mkdir()
            remote = base / "remote.git"
            run_git(base, "init", "--bare", str(remote))
            source = project()
            self.files.link(source, str(root))
            self.git.init(source)
            self.configure_identity(root)
            self.git.commit(source, "Initial project")
            self.git.set_remote(source, str(remote))
            pushed = self.git.push(source)
            self.assertEqual(pushed["upstream"], "origin/main")

            clone = base / "clone"
            run_git(base, "clone", str(remote), str(clone))
            self.configure_identity(clone)
            manifest = clone / "beacon.yaml"
            manifest.write_text(manifest.read_text().replace("Git Project", "Remote Project"))
            run_git(clone, "add", "beacon.yaml")
            run_git(clone, "commit", "-m", "Rename project")
            run_git(clone, "push")

            pulled = self.git.pull(source)
            self.assertEqual(pulled["behind"], 0)
            self.files.reload(source)
            self.assertEqual(source["name"], "Remote Project")

    def test_pull_refuses_local_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)
            self.git.init(source)
            (root / "beacon.yaml").write_text("changed")
            with self.assertRaisesRegex(ProjectGitError, "Commit or discard"):
                self.git.pull(source)

    def test_working_and_last_commit_diffs_are_limited_to_public_project_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)
            self.git.init(source)
            self.configure_identity(root)
            self.git.commit(source, "Initial project")

            manifest = root / "beacon.yaml"
            manifest.write_text(manifest.read_text().replace("Git Project", "Changed Project"))
            new_endpoint = root / "endpoints" / "new-endpoint.yaml"
            new_endpoint.write_text("id: new\nname: New endpoint\n")

            working = self.git.diff(source, "working")
            by_path = {item["path"]: item for item in working["files"]}
            self.assertIn("beacon.yaml", by_path)
            self.assertIn("endpoints/new-endpoint.yaml", by_path)
            self.assertIn("+  name: Changed Project", by_path["beacon.yaml"]["patch"])
            self.assertIn("+id: new", by_path["endpoints/new-endpoint.yaml"]["patch"])

            last = self.git.diff(source, "last_commit", "beacon.yaml")
            self.assertEqual(last["commit"]["subject"], "Initial project")
            self.assertEqual([item["path"] for item in last["files"]], ["beacon.yaml"])
            with self.assertRaisesRegex(ProjectGitError, "public Beacon"):
                self.git.diff(source, "working", ".beacon/environments.local.yaml")

    def test_clone_uses_repository_name_and_preserves_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source_root = base / "source"
            source_root.mkdir()
            source = project()
            self.files.link(source, str(source_root))
            self.git.init(source)
            self.configure_identity(source_root)
            self.git.commit(source, "Initial project")
            remote = base / "beacon-team.git"
            run_git(base, "init", "--bare", str(remote))
            self.git.set_remote(source, str(remote))
            self.git.push(source)

            destination = base / "clones"
            destination.mkdir()
            cloned = self.git.clone(str(remote), str(destination))

            self.assertEqual(cloned, (destination / "beacon-team").resolve())
            self.assertTrue((cloned / "beacon.yaml").is_file())
            self.assertEqual(run_git(cloned, "remote", "get-url", "origin"), str(remote))

    def test_create_list_and_switch_beacon_branches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)
            self.git.init(source)
            self.configure_identity(root)
            self.git.commit(source, "Initial project")

            created = self.git.create_branch(source, "feature/auth-flow")
            self.assertEqual(created["current"], "feature/auth-flow")
            self.assertEqual(
                {item["name"] for item in created["local"]},
                {"main", "feature/auth-flow"},
            )
            manifest = root / "beacon.yaml"
            manifest.write_text(manifest.read_text().replace("Git Project", "Auth Flow Project"))
            self.git.commit(source, "Rename feature project")

            switched = self.git.switch_branch(source, "main")
            self.assertEqual(switched["current"], "main")
            self.files.reload(source)
            self.assertEqual(source["name"], "Git Project")

            comparison = self.git.compare_branch(source, "feature/auth-flow")
            self.assertEqual(comparison["current"], "main")
            self.assertEqual(comparison["target_only_commits"], 1)
            self.assertEqual(comparison["summary"], {"added": 0, "modified": 1, "deleted": 0})
            self.assertEqual(comparison["files"][0]["path"], "beacon.yaml")
            self.assertGreater(comparison["files"][0]["additions"], 0)

    def test_switch_blocks_changes_outside_beacon_managed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)
            self.git.init(source)
            self.configure_identity(root)
            self.git.commit(source, "Initial project")
            self.git.create_branch(source, "feature/safe")
            self.git.switch_branch(source, "main")
            (root / "notes.txt").write_text("not managed by Beacon")

            with self.assertRaisesRegex(ProjectGitError, "all repository changes"):
                self.git.switch_branch(source, "feature/safe")
            self.assertEqual(run_git(root, "branch", "--show-current"), "main")

    def test_switch_rejects_branch_for_a_different_beacon_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = project()
            self.files.link(source, directory)
            self.git.init(source)
            self.configure_identity(root)
            self.git.commit(source, "Initial project")
            run_git(root, "switch", "-c", "other-project")
            manifest = root / "beacon.yaml"
            manifest.write_text(manifest.read_text().replace("project-1", "project-2"))
            run_git(root, "add", "beacon.yaml")
            run_git(root, "commit", "-m", "Change project identity")
            run_git(root, "switch", "main")

            with self.assertRaisesRegex(ProjectGitError, "different Beacon project"):
                self.git.switch_branch(source, "other-project")
            self.assertEqual(run_git(root, "branch", "--show-current"), "main")


if __name__ == "__main__":
    unittest.main()
