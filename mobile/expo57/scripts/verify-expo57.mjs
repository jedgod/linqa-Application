import fs from "node:fs/promises";
const pkg=JSON.parse(await fs.readFile("package.json","utf8"));const expo=String(pkg.dependencies?.expo??"");const reactNative=String(pkg.dependencies?.["react-native"]??"");const react=String(pkg.dependencies?.react??"");
if(!/^~?57\./.test(expo))throw new Error(`EXPO_57_REQUIRED:found=${expo}`);if(!/^0\.86\./.test(reactNative))throw new Error(`REACT_NATIVE_086_REQUIRED:found=${reactNative}`);if(!/^19\.2\./.test(react))throw new Error(`REACT_19_2_REQUIRED:found=${react}`);console.log(`Expo ${expo}, React Native ${reactNative}, React ${react} aligned`);
