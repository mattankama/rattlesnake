"""Tests for the static build — the thing that actually gets deployed.

A break here is invisible until someone opens the deployed site, so the build is
worth a smoke test even though it never runs in the app.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from build_static import PAGES, build, build_token, normalise_base  # noqa: E402


@pytest.fixture(scope="module")
def dist(tmp_path_factory):
    return build(tmp_path_factory.mktemp("dist"))


class TestStaticBuild:
    def test_writes_a_file_per_page(self, dist):
        for target in PAGES.values():
            assert (dist / target).is_file(), target

    def test_pages_are_real_html(self, dist):
        for target in PAGES.values():
            assert (dist / target).read_bytes().startswith(b"<!DOCTYPE html>"), target

    def test_urls_survive_the_build(self, dist):
        """`/progress` is a directory index, so the deployed URL is the dev URL."""
        assert (dist / "progress" / "index.html").is_file()
        assert (dist / "routine" / "index.html").is_file()
        assert (dist / "session" / "index.html").is_file()

    def test_carries_the_static_folder(self, dist):
        assert (dist / "static" / "css" / "style.css").is_file()
        assert (dist / "static" / "js" / "local-api.js").is_file()
        assert (dist / "static" / "fonts" / "archivo-latin-var.woff2").is_file()
        assert (dist / "static" / "manifest.webmanifest").is_file()

    def test_worker_sits_at_the_root(self, dist):
        """Scope: under /static/ it could not control the pages."""
        assert (dist / "sw.js").is_file()
        assert not (dist / "static" / "sw.js").exists()

    def test_worker_is_stamped_with_a_build_token(self, dist):
        worker = (dist / "sw.js").read_text()
        assert "__BUILD__" not in worker
        assert 'const VERSION = "' in worker

    def test_nothing_points_at_a_server(self, dist):
        """No fetch() to an origin means nothing to deploy but files."""
        page = (dist / "index.html").read_text()
        assert "/api/" not in page

    def test_ships_a_nojekyll_marker(self, dist):
        assert (dist / ".nojekyll").is_file()

class TestBuildToken:
    """The token names the offline cache, so it decides when an install updates."""

    def _tree(self, tmp_path, contents):
        paths = []
        for name, text in contents.items():
            path = tmp_path / name
            path.write_text(text)
            paths.append(path)
        return paths

    def test_same_tree_gives_the_same_token(self, tmp_path):
        """Otherwise every deploy would evict a working cache for nothing."""
        (tmp_path / "a").mkdir()
        (tmp_path / "b").mkdir()
        first = self._tree(tmp_path / "a", {"x.js": "one", "y.css": "two"})
        second = self._tree(tmp_path / "b", {"x.js": "one", "y.css": "two"})
        assert build_token(first) == build_token(second)

    def test_a_changed_file_changes_the_token(self, tmp_path):
        (tmp_path / "a").mkdir()
        before = self._tree(tmp_path / "a", {"x.js": "one"})
        token = build_token(before)
        (tmp_path / "a" / "x.js").write_text("one, changed")
        assert build_token(before) != token

    def test_the_worker_is_covered_by_its_own_token(self, tmp_path):
        """A fix to sw.js alone must still invalidate an installed app's cache.

        It only does if sw.js is one of the files hashed — which is why the build
        copies it into dist before computing the token, rather than writing it
        afterwards. Built into its own tree: this one gets edited.
        """
        own = build(tmp_path / "own")
        shipped = [p for p in own.rglob("*") if p.is_file()]
        assert own / "sw.js" in shipped

        token = build_token(shipped)
        worker = own / "sw.js"
        worker.write_text(worker.read_text() + "\n// a worker-only fix\n")
        assert build_token([p for p in own.rglob("*") if p.is_file()]) != token


@pytest.fixture(scope="module")
def pages_dist(tmp_path_factory):
    """The build GitHub Pages deploys, served at mattankama.github.io/rattlesnake/."""
    return build(tmp_path_factory.mktemp("pages"), base="/rattlesnake/")


class TestBuildUnderAPath:
    def test_layout_does_not_change(self, pages_dist):
        """The host adds the path; the folder is the same shape."""
        for target in PAGES.values():
            assert (pages_dist / target).is_file(), target
        assert (pages_dist / "sw.js").is_file()

    def test_pages_point_inside_the_app(self, pages_dist):
        for target in PAGES.values():
            page = (pages_dist / target).read_text()
            assert 'src="/rattlesnake/static/js/app.js"' in page, target
            assert 'data-base="/rattlesnake"' in page, target
            assert 'src="/static' not in page, target
            assert 'href="/static' not in page, target

    def test_the_default_build_stays_at_the_root(self, dist):
        page = (dist / "index.html").read_text()
        assert 'src="/static/js/app.js"' in page
        assert 'data-base=""' in page


@pytest.mark.parametrize(
    "given, expected",
    [("/", "/"), ("", "/"), ("rattlesnake", "/rattlesnake/"), ("/rattlesnake", "/rattlesnake/"),
     ("/rattlesnake/", "/rattlesnake/"), ("a/b", "/a/b/")],
)
def test_normalise_base(given, expected):
    assert normalise_base(given) == expected
