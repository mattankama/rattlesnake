"""Tests for view routes — page rendering.

The pages carry no data. Since the API moved onto the device, a template's whole
job is to ship markup and the scripts that fill it, so these tests check exactly
that and nothing about routines or sessions — those assertions live in
tests/js/local-api.test.js, against the code that now produces them.
"""


class TestViewRoutes:
    """Page routes return correct templates."""

    def test_home_page(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"Rattlesnake" in resp.data

    def test_home_page_has_create_button(self, client):
        resp = client.get("/")
        assert b"create-routine-btn" in resp.data

    def test_home_page_has_autosave_note_slot(self, client):
        """Hidden until home.js reports a workout it saved for the lifter."""
        resp = client.get("/")
        assert b'id="autosave-note"' in resp.data
        assert b'role="status" hidden' in resp.data

    def test_home_page_has_no_progress_button(self, client):
        """Progress is reached by swiping right — deliberately no control."""
        resp = client.get("/")
        assert b"progress-link" not in resp.data
        assert b'href="/progress"' not in resp.data

    def test_home_page_has_no_subtitle(self, client):
        resp = client.get("/")
        assert b"Pick a routine and start lifting" not in resp.data

    def test_progress_route_still_reachable_directly(self, client):
        """No button does not mean no route — the URL still works."""
        assert client.get("/progress").status_code == 200

    def test_progress_page(self, client):
        resp = client.get("/progress")
        assert resp.status_code == 200
        assert b"Progress" in resp.data

    def test_progress_pane_has_pickers(self, client):
        resp = client.get("/progress")
        assert b"exercise-picker" in resp.data
        assert b"instance-picker" in resp.data

    def test_progress_page_has_no_back_link(self, client):
        """Progress is a pane, not a page — you slide right to leave it."""
        resp = client.get("/progress")
        assert b"back-link" not in resp.data

    def test_both_routes_serve_both_panes(self, client):
        """One document, two panes: sliding between them never hits the server."""
        for path in ("/", "/progress"):
            resp = client.get(path)
            assert b'id="pane-home"' in resp.data, path
            assert b'id="pane-progress"' in resp.data, path
            assert b"pager-track" in resp.data, path

    def test_routes_differ_only_in_starting_pane(self, client):
        assert b"START_PANE = 0" in client.get("/").data
        assert b"START_PANE = 1" in client.get("/progress").data

    def test_pager_js_loads(self, client):
        resp = client.get("/")
        assert b"pager.js" in resp.data

    def test_js_loads_on_progress(self, client):
        resp = client.get("/progress")
        assert b"app.js" in resp.data
        assert b"progress.js" in resp.data
        assert b"home.js" in resp.data  # the other pane is live too

    def test_routine_page(self, client):
        resp = client.get("/routine/")
        assert resp.status_code == 200
        assert b"New Routine" in resp.data

    def test_routine_page_has_form(self, client):
        resp = client.get("/routine/")
        assert b"routine-form" in resp.data
        assert b"routine-name" in resp.data

    def test_session_page(self, client):
        resp = client.get("/session/")
        assert resp.status_code == 200
        assert b"timer-display" in resp.data
        assert b"complete-session-btn" in resp.data

    def test_session_page_has_timer(self, client):
        resp = client.get("/session/")
        assert b"timer-bar" in resp.data
        assert b"00:00" in resp.data

    def test_css_loads(self, client):
        resp = client.get("/")
        assert b"style.css" in resp.data

    def test_js_loads_on_home(self, client):
        resp = client.get("/")
        assert b"app.js" in resp.data
        assert b"home.js" in resp.data

    def test_js_loads_on_routine(self, client):
        assert b"routine.js" in client.get("/routine/").data

    def test_js_loads_on_session(self, client):
        assert b"session.js" in client.get("/session/").data


class TestPagesCarryNoData:
    """A page must be the same bytes for every lifter, or it cannot be a file."""

    def test_routine_page_is_identical_with_and_without_an_id(self, client):
        """One file serves both the new-routine form and every edit URL."""
        assert client.get("/routine/").data == client.get("/routine/?id=7").data

    def test_session_page_is_identical_for_any_session(self, client):
        assert client.get("/session/").data == client.get("/session/?id=42").data

    def test_routine_page_reads_its_id_from_the_query_string(self, client):
        resp = client.get("/routine/")
        assert b"window.ROUTINE_ID" in resp.data
        assert b"URLSearchParams" in resp.data

    def test_session_page_reads_its_id_from_the_query_string(self, client):
        resp = client.get("/session/")
        assert b"window.SESSION_ID" in resp.data
        assert b"URLSearchParams" in resp.data


class TestDataLayerWiring:
    """The on-device API has to be loaded, in order, before anything calls it."""

    # Matched as `js/<name>"` — the src attribute — so a filename mentioned in a
    # comment cannot stand in for the script tag that actually loads it.
    LAYER = (b'js/store.js"', b'js/local-api.js"', b'js/persist.js"', b'js/app.js"')

    def test_every_page_loads_the_data_layer(self, client):
        for path in ("/", "/progress", "/routine/", "/session/"):
            data = client.get(path).data
            for script in self.LAYER:
                assert script in data, f"{script!r} missing from {path}"

    def test_data_layer_loads_in_dependency_order(self, client):
        data = client.get("/").data
        order = [data.index(s) for s in self.LAYER]
        assert order == sorted(order)

    def test_screen_scripts_load_after_the_data_layer(self, client):
        data = client.get("/").data
        assert data.index(b'js/app.js"') < data.index(b'js/home.js"')


class TestServiceWorker:
    """Offline is the gym case, and scope is why the worker sits at the root."""

    def test_served_from_the_root(self, client):
        resp = client.get("/sw.js")
        assert resp.status_code == 200
        assert "javascript" in resp.headers["Content-Type"]

    def test_not_cached(self, client):
        """A cached worker would pin an installed app to the day it was installed."""
        assert "no-cache" in client.get("/sw.js").headers["Cache-Control"]

    def test_precaches_the_whole_app(self, client):
        data = client.get("/sw.js").data
        for asset in (b'"/"', b'"/progress"', b'"/routine/"', b'"/session/"',
                      b"style.css", b"local-api.js", b"archivo-latin-var.woff2"):
            assert asset in data, asset


class TestRetiredRoutes:
    """The old path-segment URLs cannot exist on a static host, so they are gone."""

    def test_old_new_routine_url_is_gone(self, client):
        assert client.get("/routine/new").status_code == 404

    def test_old_edit_routine_url_is_gone(self, client):
        assert client.get("/routine/1/edit").status_code == 404

    def test_old_session_url_is_gone(self, client):
        assert client.get("/session/1").status_code == 404

    def test_routine_without_trailing_slash_redirects(self, client):
        """So a hand-typed /routine still lands, on Flask and on a static host alike."""
        resp = client.get("/routine")
        assert resp.status_code in (301, 308)
        assert resp.headers["Location"].endswith("/routine/")


class TestServedUnderAPath:
    """GitHub Pages serves the build at /rattlesnake/, so every URL a page writes carries it.

    The build renders through the test client with that script root; these are
    the same requests, so a link that forgets the prefix fails here, not on a phone.
    """

    BASE = "http://localhost/rattlesnake"
    PAGES = ("/", "/progress", "/routine/", "/session/")

    def test_dev_pages_have_no_prefix(self, client):
        data = client.get("/").data
        assert b'data-base=""' in data
        assert b'href="/static/css/style.css"' in data
        assert b'href="/routine/"' in data

    def test_every_page_hands_the_prefix_to_the_scripts(self, client):
        """app.js reads it to build the URLs it navigates to."""
        for path in self.PAGES:
            assert b'data-base="/rattlesnake"' in client.get(path, base_url=self.BASE).data, path

    def test_assets_load_from_under_the_prefix(self, client):
        for path in self.PAGES:
            data = client.get(path, base_url=self.BASE).data
            assert b'href="/rattlesnake/static/css/style.css"' in data, path
            assert b'src="/rattlesnake/static/js/app.js"' in data, path

    def test_links_between_pages_carry_the_prefix(self, client):
        assert b'href="/rattlesnake/routine/"' in client.get("/", base_url=self.BASE).data
        assert b'href="/rattlesnake/"' in client.get("/routine/", base_url=self.BASE).data

    def test_nothing_points_at_the_site_root(self, client):
        """The site root is another site now: a stray "/" lands the lifter there."""
        for path in self.PAGES:
            data = client.get(path, base_url=self.BASE).data
            for stray in (b'href="/"', b'href="/static', b'src="/static', b'href="/routine/"'):
                assert stray not in data, f"{stray!r} in {path}"

    def test_worker_registers_under_the_prefix(self, client):
        """Its folder is its scope: /rattlesnake/, and none of the other sites."""
        assert b'register("/rattlesnake/sw.js")' in client.get("/", base_url=self.BASE).data


class TestManifest:
    """Static, so it cannot be told the prefix. Relative URLs resolve to the app either way."""

    def _manifest(self, client):
        import json

        return json.loads(client.get("/static/manifest.webmanifest").data)

    def test_opens_and_scopes_to_the_app_root(self, client):
        from urllib.parse import urljoin

        manifest = self._manifest(client)
        for root in ("/", "/rattlesnake/"):
            url = root + "static/manifest.webmanifest"
            assert urljoin(url, manifest["start_url"]) == root
            assert urljoin(url, manifest["scope"]) == root

    def test_icons_resolve_inside_the_static_folder(self, client):
        from urllib.parse import urljoin

        for icon in self._manifest(client)["icons"]:
            resolved = urljoin("/rattlesnake/static/manifest.webmanifest", icon["src"])
            assert resolved.startswith("/rattlesnake/static/icons/"), icon["src"]
