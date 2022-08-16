const { promisify } = require("util");
const cliProgress = require("cli-progress");
const colors = require("ansi-colors");
const fs = require("fs");
const heicConvert = require("heic-convert");
const path = require("path");
const sharp = require("sharp");

const inputFolder = "/Users/antonpedersen/Dropbox/Bilder/Bröllop/";
const outputFolder = "./output/";

// Create a new progress bar instance and use shades_classic theme
const progressBar = new cliProgress.SingleBar(
  {
    format: `Progress [${colors.cyan(
      "{bar}"
    )}] {percentage}% | {value}/{total}`,
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
  },
  cliProgress.Presets.shades_classic
);

// Add a a zero to one digit numbers
const addPrecedingDateZero = (string, slice = 2) => {
  const zeros = "0".repeat(slice - 1);
  return `${zeros}${string}`.slice(-1 * slice);
};

// Format date to string
const formatDateTime = (birthtime) => {
  const year = birthtime.getFullYear();
  const month = addPrecedingDateZero(birthtime.getMonth() + 1);
  const date = addPrecedingDateZero(birthtime.getDate());
  const hours = addPrecedingDateZero(birthtime.getHours());
  const minutes = addPrecedingDateZero(birthtime.getMinutes());
  const seconds = addPrecedingDateZero(birthtime.getSeconds());
  const milliseconds = addPrecedingDateZero(birthtime.getMilliseconds(), 3);

  return `${year}-${month}-${date}-${hours}-${minutes}-${seconds}-${milliseconds}`;
};

// Format directory name of the file
const formatDirectoryName = (string) => {
  return string
    .replace(inputFolder, "")
    .split("/")
    .filter((s) => s)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/\ /g, "-")
        // Replace åäö doesn't seem to work in node?
        .replace(/[åä]/g, "a")
        .replace(/ö/g, "o")
    )
    .join("-");
};

// Add a string to a specific position in another string
const insertString = (str, index, value) => {
  return str.substr(0, index) + value + str.substr(index);
};

/**
 * Create the file object used when copying the file
 */
const createFileObject = (filePath, dirPath) => {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (e, stats) => {
      if (e) {
        reject("Error...");
      }

      const { birthtime } = stats;
      const dateTimeName = formatDateTime(birthtime);
      const fileGroupName = formatDirectoryName(dirPath);
      let extension = path.extname(filePath).toLocaleLowerCase();

      // Change .jpeg files to .jpg for consistency
      if (extension === ".jpeg") {
        extension = ".jpg";
      }

      // Build the final name of the file after it's copied
      const outputFileName = `${dateTimeName}${
        fileGroupName ? `-${fileGroupName}` : ""
      }${extension}`;

      resolve({
        sourcePath: filePath,
        targetPath: `${outputFolder}${outputFileName}`,
      });
    });
  });
};

/**
 * Loop inputFolder for sub directories and find nested files
 */
const fileTypes = new Set();

const loopDirectoryRecursive = async (dirPath) => {
  let files = [];

  // Fined sub directories and files in current folder
  const fileNames = await fs.promises.readdir(dirPath);

  for (const fileNameRaw of fileNames) {
    // Get data from the file
    const fileName = fileNameRaw.trim();
    const extension = path.extname(fileName);
    const skipFile =
      [".DS_Store", "Icon"].includes(fileName) ||
      [".dng", ".DNG", ".db"].includes(extension);
    const isDirectory = !extension && !skipFile;

    fileTypes.add(extension);

    const filePath = `${dirPath}${fileName}`;

    // If it's a diretory, dig deeper
    if (isDirectory) {
      const recursiveFiles = await loopDirectoryRecursive(`${filePath}/`);
      files = files.concat(recursiveFiles);

      // If it's a file, add it to the list of files to copy
    } else if (!skipFile) {
      const fileData = await createFileObject(filePath, dirPath);
      files.push(fileData);
    }
  }

  return files;
};

/**
 * Take a list of files and copy them to output folder
 */
const copyFiles = async (files) => {
  // Loop trough all files and copy them to target path
  for (const file of files) {
    // .heic images should be converted to .jpg
    if (file.targetPath.includes(".heic")) {
      const inputBuffer = await promisify(fs.readFile)(file.sourcePath);
      const outputBuffer = await heicConvert({
        buffer: inputBuffer, // the HEIC file buffer
        format: "JPEG", // output format
        quality: 1, // the jpeg compression quality, between 0 and 1
      });
      file.targetPath = file.targetPath.replace(".heic", ".jpg");
      await promisify(fs.writeFile)(file.targetPath, outputBuffer);

      // All other files are just copied
    } else {
      await fs.promises.copyFile(file.sourcePath, file.targetPath, (e) => {
        if (e) {
          console.error(`Error: ${file.sourcePath}`);
        }
      });
    }

    progressBar.increment();
  }
};

/**
 * Resize images to a okey size
 */

const resizeFiles = async (files) => {
  for (const file of files) {
    if (file.targetPath.endsWith(".jpg")) {
      await new Promise((resolve, reject) => {
        sharp(file.targetPath)
          .resize({ width: 1040 })
          .toBuffer((err, buffer) => {
            fs.writeFile(file.targetPath, buffer, (e) => {
              if (e) {
                reject();
              } else {
                resolve();
              }
            });
          });
      });
    }

    progressBar.increment();
  }
};

/**
 * Start the script
 */
const start = async () => {
  console.info("Begin");

  // Find all files that should be copied and renamed
  console.info("Find files to copy");
  const files = await loopDirectoryRecursive(inputFolder);
  console.info(`Found ${files.length} files to copy`);

  //console.info("Found file types", fileTypes);

  // Create an output folder if it doesn't exists already
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder);
    console.info(`Folder ${outputFolder} Created Successfully.`);
  }

  // Test output files for duplicates
  const unique = {};

  files.forEach((file) => {
    if (unique[file.targetPath]) {
      const lastIndexOf = file.targetPath.lastIndexOf(".");
      let i = 2;
      let uniqueFilename = insertString(
        file.targetPath,
        lastIndexOf,
        `-${addPrecedingDateZero(i)}`
      );

      while (unique[uniqueFilename]) {
        i++;
        uniqueFilename = insertString(
          file.targetPath,
          lastIndexOf,
          `-${addPrecedingDateZero(i)}`
        );
      }

      unique[uniqueFilename] = true;
      file.targetPath = uniqueFilename;
    } else {
      unique[file.targetPath] = true;
    }
  });

  // Start terminal progress bar
  console.log("Begin file proccessing...");
  progressBar.start(files.length * 2, 0);

  // Copy the files to the output folder
  await copyFiles(files);

  // Resize images
  await resizeFiles(files);

  // Copying complete
  progressBar.stop();
  console.log("File proccessing complete");
};
start();
