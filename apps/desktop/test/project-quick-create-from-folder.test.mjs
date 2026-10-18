/**
 * The Projects toolbar's folder button turns one native pick into one project:
 * the picked folder becomes the project root and its basename the project
 * name, without going through the Create project dialog. The store action owns
 * the picker, so the sidebar stays a thin caller, a cancelled pick creates
 * nothing, and a folder that already belongs to a project is reopened instead
 * of duplicated.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createProjectSlice } = await import(
  "../src/stores/slices/project-slice.ts"
);
const { api } = await import("../src/lib/api.ts");

const FOLDER = "/Users/dev/work/api-server";
const OTHER_FOLDER = "/Users/dev/work/web-client";

// Opening a project remembers it in the renderer's recent-project cache;
// Node has no localStorage, so the harness supplies the same tiny surface.
const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => void stored.set(key, String(value)),
  removeItem: (key) => void stored.delete(key),
};

/**
 * Real slice, stubbed host: only the `api` calls one quick pick reaches are
 * replaced, and every call is recorded for the assertions.
 */
function harness() {
  const calls = { created: [], activated: [], listed: 0 };
  let state = {
    activeProjectPath: undefined,
    workspace: null,
    openProjects: [],
    openProjectPaths: [],
    projectMeta: {},
    sessions: [],
    page: "chat",
    resetWorkPanelContext: () => {},
    showToast: () => {},
  };
  const slice = createProjectSlice({
    get: () => state,
    set: (update) => {
      state = {
        ...state,
        ...(typeof update === "function" ? update(state) : update),
      };
    },
    runtime: {
      beginNavigationIntent: () => 1,
      navigationIntentIsCurrent: () => true,
      isSessionSelectionForIntent: () => false,
    },
    withoutRecordKey: (record, key) =>
      Object.fromEntries(
        Object.entries(record).filter(([id]) => id !== key),
      ),
    withProjectDisplayName: (workspace) => workspace,
    promoteProjectPath: (paths, path) => [
      path,
      ...paths.filter((item) => item !== path),
    ],
    removeProjectPath: (paths, path) => paths.filter((item) => item !== path),
    upsertWorkspace: (projects, workspace) => [...projects, workspace],
    persistCurrentSidebar: () => {},
  });
  Object.assign(state, slice);
  return { get: () => state, calls };
}

/** Patch the host calls one quick pick reaches; restored after each test. */
function stubApi(t, overrides) {
  const originals = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    originals.set(name, api[name]);
    api[name] = value;
  }
  t.after(() => {
    for (const [name, value] of originals) api[name] = value;
  });
}

function stubHost(t, harnessed, { groups = [], picked } = {}) {
  stubApi(t, {
    pickProjectFolders: async () =>
      picked ?? { folders: [FOLDER], canceled: false },
    listProjectGroups: async () => {
      harnessed.calls.listed += 1;
      return { groups };
    },
    createProjectGroup: async (name, folders) => {
      harnessed.calls.created.push({ name, folders });
      return {
        group: {
          primaryPath: folders[0],
          roots: folders.map((path) => ({ path })),
        },
      };
    },
    setProject: async (path) => {
      harnessed.calls.activated.push(path);
      return { workspace: { path, name: "api-server", branch: "main" } };
    },
    getOnboarding: async () => ({ dismissed: true }),
  });
}

test("one pick creates a project named after the folder and opens it", async (t) => {
  const h = harness();
  stubHost(t, h);

  await h.get().createProjectFromPickedFolder();

  assert.deepEqual(h.calls.created, [
    { name: "api-server", folders: [FOLDER] },
  ]);
  assert.deepEqual(h.calls.activated, [FOLDER]);
  assert.equal(h.get().activeProjectPath, FOLDER);
  assert.deepEqual(h.get().workspace, {
    path: FOLDER,
    name: "api-server",
    branch: "main",
  });
});

test("a multi-folder pick is named after its primary folder", async (t) => {
  const h = harness();
  stubHost(t, h, {
    picked: { folders: [FOLDER, OTHER_FOLDER], canceled: false },
  });

  await h.get().createProjectFromPickedFolder();

  assert.deepEqual(h.calls.created, [
    { name: "api-server", folders: [FOLDER, OTHER_FOLDER] },
  ]);
  assert.deepEqual(h.calls.activated, [FOLDER]);
});

test("a cancelled pick creates no project and changes no workspace", async (t) => {
  const h = harness();
  stubHost(t, h, { picked: { folders: [], canceled: true } });

  await h.get().createProjectFromPickedFolder();

  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.activated, []);
  assert.equal(h.calls.listed, 0);
  assert.equal(h.get().activeProjectPath, undefined);
  assert.equal(h.get().workspace, null);
});

test("a folder that already belongs to a project reopens that project", async (t) => {
  const h = harness();
  stubHost(t, h, {
    groups: [
      {
        primaryPath: FOLDER,
        roots: [{ path: FOLDER }, { path: OTHER_FOLDER }],
      },
    ],
  });

  await h.get().createProjectFromPickedFolder();

  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.activated, [FOLDER]);
  assert.equal(h.get().activeProjectPath, FOLDER);
});

test("the projects toolbar offers the quick open-folder action beside new project", async () => {
  const sidebar = await readFile(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8",
  );
  const section = sidebar.indexOf('data-sidebar-section="projects"');
  const end = sidebar.indexOf("\n        </div>", section);
  const toolbar = sidebar.slice(sidebar.lastIndexOf("<div", section), end);

  assert.ok(section > 0 && end > section, "the projects toolbar should exist");
  assert.match(toolbar, /t\("nav\.projects"\)/);
  assert.match(toolbar, /className="sidebar-toolbar-actions"/);
  assert.match(toolbar, /data-action="new-project"/);
  assert.match(toolbar, /data-action="open-folder-as-project"/);
  assert.match(
    toolbar,
    /data-action="open-folder-as-project"[\s\S]*?ariaLabel=\{t\("nav\.openFolderAsProject"\)\}[\s\S]*?onClick=\{\(\) => void openFolderAsProject\(\)\}[\s\S]*?<IconFolderOpen size=\{14\}/,
  );
  // The sidebar only forwards the click; the store owns picker and creation.
  assert.match(
    sidebar,
    /const openFolderAsProject = async \(\) => \{[\s\S]*?await createProjectFromPickedFolder\(\)[\s\S]*?reportError\(error\)/,
  );
  assert.match(
    sidebar,
    /createProjectFromPickedFolder = useAppStore\(\s*\(s\) => s\.createProjectFromPickedFolder,?\s*\)/,
  );
});
