const compression = process.env.CODE_UX_ELECTRON_COMPRESSION || "normal";
const output = process.env.CODE_UX_ELECTRON_OUTPUT || "release/electron";

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
    "build/icon*.png",
    "package.json",
    "!node_modules/**",
    "!**/*.map",
    "!**/*.tsbuildinfo",
  ],
  asar: true,
  asarUnpack: [
    "node_modules/**/*.node",
    "node_modules/onnxruntime-node/**",
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
    target: [
      "AppImage",
      "deb",
      "tar.gz",
    ],
  },
};
