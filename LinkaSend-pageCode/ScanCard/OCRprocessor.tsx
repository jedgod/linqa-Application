import { ImageEditor, ImageManipulator } from 'expo-image-manipulator'; // or similar lib

const preprocessImage = async (uri: string): Promise<string> => {
  // Adjust brightness, contrast, crop, or rotate image
  const processed = await ImageManipulator.manipulateAsync(uri, [
    { resize: { width: 1080 } },
    { rotate: 0 },
    { contrast: 1.2 },
    { brightness: 0.1 },
  ]);
  return processed.uri;
};
