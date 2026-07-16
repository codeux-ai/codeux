const compression = process.env.CODE_UX_ELECTRON_COMPRESSION || "normal";
const output = process.env.CODE_UX_ELECTRON_OUTPUT || "release/electron";
const nativeRuntimePackages = [
  // Local speech transcription loads ONNX Runtime from the packaged Node
  // runtime tree. Keep it outside ASAR so native bindings and provider
  // metadata remain loadable after installation.
  "node_modules/onnxruntime-node/**",
];

const removableNodeModuleFile = /(?:^|[\\/])(?:readme(?:\.[^\\/]*)?|changelog(?:\.[^\\/]*)?|history(?:\.[^\\/]*)?)$/i;
const removableNodeModulePath = /[\\/](?:docs?|examples?|test|tests|__tests__|coverage|benchmarks?)[\\/]/i;

function onNodeModuleFile(filePath) {
  if (/[\\/](?:licen[cs]e|copying|notice)(?:\.[^\\/]*)?$/i.test(filePath)) {
    return undefined;
  }
  if (removableNodeModuleFile.test(filePath) || removableNodeModulePath.test(filePath)) {
    return false;
  }
  if (/\.(?:map|md|markdown|ts|tsx|d\.ts|c|cc|cpp|h|hpp|node-gyp|mk)$/i.test(filePath)) {
    return false;
  }
  return undefined;
}

module.exports = {
  toolsets: {
    nsis: "1.2.1",
  },
  appId: "com.codeux.desktop",
  productName: "Code UX",
  artifactName: "Code-UX-${version}-${os}-${arch}.${ext}",
  compression,
  electronLanguages: ["en-US"],
  directories: {
    output,
  },
  extraMetadata: {
    main: "dist/electron/main.js",
  },
  icon: "build/icon.png",
  files: [
    "dist/**",
    "!dist/*-unpacked/**",
    "!dist/builder-debug.yml",
    "!dist/builder-effective-config.yaml",
    "dashboard/dist/**",
    "docs-web/**",
    "assets/models-dev/catalog.json",
    "build/icon*.png",
    "package.json",
    "!node_modules/**",
    "!**/*.map",
    "!**/*.tsbuildinfo",
  ],
  asar: true,
  asarUnpack: [
    "node_modules/**/*.node",
    ...nativeRuntimePackages,
  ],
  onNodeModuleFile,
  extraResources: [
    {
      from: ".cache/electron-runtime/node_modules",
      to: "node_modules",
    },
    {
      from: "build",
      to: "build",
      filter: [
        "icon*.png",
      ],
    },
    {
      from: "build/installer-license.txt",
      to: "LICENSE.txt",
    },
    {
      from: ".code-ux",
      to: ".code-ux-defaults",
      filter: [
        "agents/planning_agent.md",
        "agents/project_manager.md",
        "agents/quality_assurance_agent.md",
        "agents/worker.md",
        "container/setup.sh",
        "quicksprints/templates/*.md",
      ],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    target: [
      "dmg",
      "zip",
    ],
  },
  win: {
    icon: "build/icon.ico",
    target: [
      "nsis",
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    perMachine: false,
    // Electron Builder 26.15.6 points its unified NSIS 3.12 bundle back at
    // NSISDIR/windows/Plugins on native Windows. makensis already searches
    // that directory, so assisted installers see duplicate nsDialogs/System
    // plugin commands and abort before producing the installer. Keep the
    // NSIS 3.12 compiler and standard plugins, but source Electron Builder's
    // extra plugins from its checksum-pinned standalone resource archive.
    customNsisResources: {
      version: "3.4.1",
      url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z",
      checksum: "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
    },
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    license: "build/installer-license.txt",
    include: "build/installer.nsh",
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    installerHeaderIcon: "build/icon.ico",
    installerHeader: "build/installerHeader.bmp",
    installerSidebar: "build/installerSidebar.bmp",
    uninstallerSidebar: "build/uninstallerSidebar.bmp",
  },
  linux: {
    category: "Development",
    maintainer: "Pierre Voss <p.voss@codeux.ai>",
    executableName: "codeux",
    target: [
      "AppImage",
      "deb",
      "tar.gz",
    ],
  },
};
