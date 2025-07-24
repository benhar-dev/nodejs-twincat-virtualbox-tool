import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { input, rawlist } from "@inquirer/prompts";
import os from "os";

// Set default values
const virtualBoxPath = "C:\\Program Files\\Oracle\\VirtualBox";
const isoFolder = path.join(process.cwd(), "iso"); // 'iso' folder in the repo
const hddSizeGBDefault = 10;

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

// Check if the ISO folder exists and contains ISOs
function getAvailableISOs() {
  if (!fs.existsSync(isoFolder)) {
    logError(
      `'iso' folder not found. Please create a folder named 'iso' and place your ISOs there.`
    );
    process.exit(1);
  }
  const isoFiles = fs
    .readdirSync(isoFolder)
    .filter((file) => file.endsWith(".iso"));
  if (isoFiles.length === 0) {
    logError(`No ISO files found in the 'iso' folder. Please add some ISOs.`);
    process.exit(1);
  }
  return isoFiles;
}

// Prompt user for input
async function promptUser() {
  const availableISOs = getAvailableISOs();

  // Prompt for VM Name with default
  const virtualMachineName = await input({
    message: "Enter Virtual Machine Name:",
    default: `TwinCAT_BSD_${getTimestamp()}`,
  });

  // Prompt to select an ISO from the available list
  const isoSelection = await rawlist({
    message: "Select an ISO from the available list:",
    choices: availableISOs.map((iso) => ({ name: iso, value: iso })),
  });

  // Prompt for HDD size with validation
  const hddSizeGB = await input({
    message: "Enter HDD size (GB):",
    default: hddSizeGBDefault,
    validate: (input) =>
      !isNaN(input) && input > 0
        ? true
        : "Please enter a valid number greater than 0.",
  });

  // Prompt for VM folder with default from VBoxManage
  const vmFolder = await input({
    message: "Enter folder to store VM:",
    default: getDefaultVMFolder(),
  });

  return {
    virtualMachineName,
    isoSelection,
    hddSizeGB: parseInt(hddSizeGB, 10), // Ensure HDD size is parsed as an integer
    vmFolder,
  };
}

// Create VM and start setup
async function setupVM() {
  const { virtualMachineName, isoSelection, hddSizeGB, vmFolder } =
    await promptUser();
  const vboxManage = checkVBoxManage();
  const isoPath = path.join(isoFolder, isoSelection);
  const workingDirectory = vmFolder;

  // Check for ISO file
  if (!fs.existsSync(isoPath)) {
    logError(`Failed: Missing TCBSD image: ${isoSelection}`);
    process.exit(1);
  }

  // Check if the VM already exists
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
    `"${vboxManage}" createvm --name ${virtualMachineName} --basefolder "${workingDirectory}" --ostype FreeBSD_64 --register`
  );
  execSync(
    `"${vboxManage}" modifyvm "${virtualMachineName}" --memory 1024 --vram 128 --acpi on --hpet on --graphicscontroller vmsvga --firmware efi64`
  );

  // Set bridged network
  const bridgedAdapters = execSync(`"${vboxManage}" list bridgedifs`, {
    encoding: "utf-8",
  });
  const firstAdapter = bridgedAdapters.split("\n")[0].split(":")[1]?.trim();

  if (!firstAdapter) {
    logInfo(
      "No bridged adapters found. Network adapter will not be configured."
    );
  } else {
    logInfo(`Setting bridged network adapter to: ${firstAdapter}`);
    execSync(
      `"${vboxManage}" modifyvm "${virtualMachineName}" --nic1 bridged --bridgeadapter1 "${firstAdapter}"`
    );
  }

  // Convert ISO to VDI
  logStep("Converting ISO to installer VDI...");
  const installerVdi = path.join(
    workingDirectory,
    virtualMachineName,
    "TcBSD_installer.vdi"
  );
  execSync(
    `"${vboxManage}" convertfromraw --format VDI ${isoPath} "${installerVdi}"`
  );

  // Setup storage
  const runtimeVhd = path.join(
    workingDirectory,
    virtualMachineName,
    "TcBSD.vhd"
  );
  execSync(
    `"${vboxManage}" storagectl "${virtualMachineName}" --name SATA --add sata --controller IntelAhci --hostiocache on --bootable on`
  );
  execSync(
    `"${vboxManage}" storageattach "${virtualMachineName}" --storagectl "SATA" --port 1 --device 0 --type hdd --medium "${installerVdi}"`
  );

  logStep(`Creating runtime HDD: ${hddSizeGB}GB`);
  const hddSizeMB = hddSizeGB * 1024;
  execSync(
    `"${vboxManage}" createmedium --filename "${runtimeVhd}" --size ${hddSizeMB} --format VHD`
  );
  execSync(
    `"${vboxManage}" storageattach "${virtualMachineName}" --storagectl "SATA" --port 0 --device 0 --type hdd --medium "${runtimeVhd}"`
  );

  // Start VM
  const vmDir = path.join(workingDirectory, virtualMachineName);
  const vboxFile = path.join(vmDir, `${virtualMachineName}.vbox`);
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
