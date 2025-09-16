import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { input, rawlist } from "@inquirer/prompts";
import os from "os";

// Set default values
const virtualBoxPath = "C:\\Program Files\\Oracle\\VirtualBox";
const installerImagesFolder = path.join(process.cwd(), "installerImages"); // 'installerImages' folder in the repo
const hddSizeGBDefault = 10;

// Define OS profiles
const osProfiles = {
  TcBSD: {
    name: "TcBSD",
    ostype: "FreeBSD_64",
    memoryMB: 1024,
    cpus: 1,
    efi: true,
    firmware: "efi64",
    graphicsController: "vmsvga",
    diskFormat: "VHD",
    diskSizeGB: hddSizeGBDefault,
  },
  TcLinux: {
    name: "TcLinux",
    ostype: "Debian_64",
    memoryMB: 4096,
    cpus: 4,
    efi: true,
    firmware: "efi",
    graphicsController: "vmsvga",
    diskFormat: "VHD",
    diskSizeGB: 40,
  },
};

function logInfo(msg) {
  console.log(`${msg}`);
}
function logStep(msg) {
  console.log(`\n➤ ${msg}`);
}
function logSuccess(msg) {
  console.log(`✔ ${msg}`);
}

function logError(msg) {
  console.error(`${msg}`);
}

// Detect OS type from filename prefix
function detectOsTypeFromFilename(filename) {
  if (filename.startsWith("TCLUR")) return "TcLinux";
  if (filename.startsWith("TCBSD")) return "TcBSD";
  return null; // Unknown or custom
}

// Get default VM folder from VirtualBox
// If it fails, fallback to user's home directory
function getDefaultVMFolder() {
  try {
    const output = execSync(
      `"${virtualBoxPath}\\VBoxManage.exe" list systemproperties`,
      {
        encoding: "utf8",
      }
    );
    const match = output.match(/Default machine folder:\s+(.*)/);
    return match ? match[1].trim() : null;
  } catch (error) {
    logError("Could not detect default VirtualBox VM folder. Falling back.");
    return path.join(os.homedir(), "VirtualBox VMs");
  }
}

// Function to get current timestamp
function getTimestamp() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1); // Months are 0-indexed
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());

  return `${year}${month}${day}_${hour}${minute}${second}`; // e.g., 20250724_134205
}

// Check for VBoxManage
function checkVBoxManage() {
  const vboxManage = path.join(virtualBoxPath, "VBoxManage.exe");
  if (!fs.existsSync(vboxManage)) {
    logError(`Failed: VBoxManage not found at: ${virtualBoxPath}`);
    logError("Please install VirtualBox or provide the correct path.");
    process.exit(1);
  }
  return vboxManage;
}

// List bridged network adapters using VBoxManage
function listBridgedAdapters(vboxManage) {
  try {
    const output = execSync(`"${vboxManage}" list bridgedifs`, {
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("Name:"))
      .map((line) => line.split(":")[1].trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

// List host-only adapters using VBoxManage
function listHostOnlyAdapters(vboxManage) {
  try {
    const output = execSync(`"${vboxManage}" list hostonlyifs`, {
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("Name:"))
      .map((line) => line.split(":")[1].trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

// Check if the images folder exists and contains ISO or IMG files
function getAvailableInstallerImages() {
  if (!fs.existsSync(installerImagesFolder)) {
    logError(
      `'installerImages' folder not found. Please create a folder named 'installerImages' and place your ISOs and IMG files there.`
    );
    process.exit(1);
  }
  const imgFiles = fs
    .readdirSync(installerImagesFolder)
    .filter((file) => file.endsWith(".iso") || file.endsWith(".img"));
  if (imgFiles.length === 0) {
    logError(
      `No image files found in the 'installerImages' folder. Please add some ISOs or IMG files.`
    );
    process.exit(1);
  }
  return imgFiles;
}

// Prompt user for input
async function promptUser() {
  const availableInstallerImages = getAvailableInstallerImages();

  const virtualMachineName = await input({
    message: "Enter Virtual Machine Name:",
    default: `TwinCAT_VM_${getTimestamp()}`,
  });

  const imgSelection = await rawlist({
    message: "Select an image file (.iso or .img):",
    choices: availableInstallerImages.map((img) => ({ name: img, value: img })),
  });

  // Try to auto-detect OS from filename
  let detectedOs = detectOsTypeFromFilename(imgSelection);
  let osType;
  if (detectedOs) {
    logInfo(`Auto-detected OS type: ${detectedOs}`);
    osType = detectedOs;
  } else {
    osType = await rawlist({
      message: "Select the VM operating system type:",
      choices: Object.keys(osProfiles).map((key) => ({
        name: key,
        value: key,
      })),
    });
  }

  const profile = osProfiles[osType];
  const hddSizeGB = await input({
    message: `Enter HDD size (GB):`,
    default: profile.diskSizeGB,
    validate: (input) =>
      !isNaN(input) && input > 0
        ? true
        : "Please enter a valid number greater than 0.",
  });

  const vmFolder = await input({
    message: "Enter folder to store VM:",
    default: getDefaultVMFolder(),
  });

  let networkType = await rawlist({
    message: "Choose network mode:",
    choices: [
      { name: "NAT", value: "nat" },
      { name: "Bridged", value: "bridged" },
    ],
  });

  let bridgedAdapter = null;
  if (networkType === "bridged") {
    const vboxManage = checkVBoxManage();
    const adapters = listBridgedAdapters(vboxManage);
    if (adapters.length === 0) {
      logInfo("No bridged adapters found. Using NAT.");
      networkType = "nat";
    } else {
      bridgedAdapter = await rawlist({
        message: "Select a bridged adapter:",
        choices: adapters.map((a) => ({ name: a, value: a })),
      });
    }
  }

  // Optional host-only adapter as Adapter 2
  let useHostOnlyAdapter = false;
  let hostOnlyAdapter = null;

  const addHostOnly = await rawlist({
    message: "Do you want to add a Host-Only Adapter (Adapter 2)?",
    choices: [
      { name: "No", value: false },
      { name: "Yes", value: true },
    ],
  });
  useHostOnlyAdapter = addHostOnly;

  if (useHostOnlyAdapter) {
    const vboxManage = checkVBoxManage();
    const adapters = listHostOnlyAdapters(vboxManage);

    if (adapters.length === 0) {
      logInfo("No Host-Only adapters found. Skipping Adapter 2.");
      useHostOnlyAdapter = false;
    } else {
      hostOnlyAdapter = await rawlist({
        message: "Select a Host-Only Adapter for Adapter 2:",
        choices: adapters.map((name) => ({ name, value: name })),
      });
    }
  }

  return {
    virtualMachineName,
    imgSelection,
    hddSizeGB: parseInt(hddSizeGB, 10),
    vmFolder,
    networkType,
    bridgedAdapter,
    osType,
    useHostOnlyAdapter,
    hostOnlyAdapter,
  };
}

// Create VM and start setup
async function setupVM() {
  const {
    virtualMachineName,
    imgSelection,
    hddSizeGB,
    vmFolder,
    networkType,
    bridgedAdapter,
    osType,
    useHostOnlyAdapter,
    hostOnlyAdapter,
  } = await promptUser();

  const profile = osProfiles[osType];
  const vboxManage = checkVBoxManage();
  const imgPath = path.join(installerImagesFolder, imgSelection);
  const workingDirectory = vmFolder;

  if (!profile) {
    logError(`Unsupported OS type: ${osType}`);
    process.exit(1);
  }

  if (!fs.existsSync(imgPath)) {
    logError(`Failed: Missing image: ${imgSelection}`);
    process.exit(1);
  }

  const existingVMs = execSync(`"${vboxManage}" list vms`, {
    encoding: "utf-8",
  });
  if (existingVMs.includes(`"${virtualMachineName}"`)) {
    logInfo(`Virtual Machine '${virtualMachineName}' already exists.`);
    logInfo("To recreate, manually delete it from VirtualBox first.");
    process.exit(1);
  }

  // Create VM
  logStep(`Creating VM: ${virtualMachineName}`);
  execSync(
    `"${vboxManage}" createvm --name "${virtualMachineName}" --basefolder "${workingDirectory}" --ostype ${profile.ostype} --register`
  );
  execSync(
    `"${vboxManage}" modifyvm "${virtualMachineName}" ` +
      `--memory ${profile.memoryMB} --cpus ${profile.cpus} ` +
      `--acpi on --hpet on --graphicscontroller ${profile.graphicsController} ` +
      `--firmware ${profile.firmware}`
  );

  // Configure networking
  if (networkType === "bridged") {
    if (!bridgedAdapter) {
      logInfo(
        "No bridged adapters found. Network adapter will not be configured."
      );
    } else {
      logInfo(`Setting bridged network adapter to: ${bridgedAdapter}`);
      execSync(
        `"${vboxManage}" modifyvm "${virtualMachineName}" --nic1 bridged --bridgeadapter1 "${bridgedAdapter}"`
      );
    }
  } else {
    logInfo("Setting network adapter to NAT");
    execSync(`"${vboxManage}" modifyvm "${virtualMachineName}" --nic1 nat`);
  }

  // Optional Host-Only Adapter as Adapter 2
  if (useHostOnlyAdapter && hostOnlyAdapter) {
    logInfo(`Adding Host-Only Adapter on Adapter 2: ${hostOnlyAdapter}`);
    execSync(
      `"${vboxManage}" modifyvm "${virtualMachineName}" ` +
        `--nic2 hostonly --hostonlyadapter2 "${hostOnlyAdapter}"`
    );
  }

  // Convert raw installer image
  logStep("Converting image to installer VDI...");
  const installerVdi = path.join(
    workingDirectory,
    virtualMachineName,
    "installer.vdi"
  );
  execSync(
    `"${vboxManage}" convertfromraw --format VDI "${imgPath}" "${installerVdi}"`
  );

  // Setup storage controller
  execSync(
    `"${vboxManage}" storagectl "${virtualMachineName}" --name SATA --add sata --controller IntelAhci --hostiocache on --bootable on`
  );

  // Attach installer image
  execSync(
    `"${vboxManage}" storageattach "${virtualMachineName}" --storagectl "SATA" --port 1 --device 0 --type hdd --medium "${installerVdi}"`
  );

  // Create and attach runtime HDD
  logStep(`Creating runtime HDD: ${hddSizeGB}GB`);
  const runtimeVhd = path.join(
    workingDirectory,
    virtualMachineName,
    "runtime.vhd"
  );
  const hddSizeMB = hddSizeGB * 1024;
  execSync(
    `"${vboxManage}" createmedium --filename "${runtimeVhd}" --size ${hddSizeMB} --format ${profile.diskFormat}`
  );
  execSync(
    `"${vboxManage}" storageattach "${virtualMachineName}" --storagectl "SATA" --port 0 --device 0 --type hdd --medium "${runtimeVhd}"`
  );

  // Launch VM
  const vboxFile = path.join(
    workingDirectory,
    virtualMachineName,
    `${virtualMachineName}.vbox`
  );
  logStep("Starting Virtual Machine...");
  execSync(`start "" "${vboxFile}"`);
  logSuccess(`Virtual Machine '${virtualMachineName}' setup complete.`);
}

process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    logError("Exiting");
  } else {
    throw error;
  }
});

setupVM();
