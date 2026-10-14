// Thin wrappers over the system pickers. Each returns PrepareInput items ready
// for AttachmentService.prepare, or [] if the user cancelled.

import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { PrepareInput, kindForMime } from "./AttachmentService";
import { withSystemUi } from "../../../services/system-ui-guard";

export async function pickDocuments(): Promise<PrepareInput[]> {
  const res = await withSystemUi(() => DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }));
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    mime: a.mimeType ?? "application/octet-stream",
    kind: kindForMime(a.mimeType ?? ""),
  }));
}

export async function pickPhotos(): Promise<PrepareInput[]> {
  const perm = await withSystemUi(() => ImagePicker.requestMediaLibraryPermissionsAsync());
  if (!perm.granted) return [];
  const res = await withSystemUi(() => ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 0.9,
    exif: false, // drop GPS and camera metadata before anything is sent
  }));
  if (res.canceled) return [];
  return res.assets.map(fromImagePickerAsset);
}

export async function takePhotoOrVideo(): Promise<PrepareInput[]> {
  const perm = await withSystemUi(() => ImagePicker.requestCameraPermissionsAsync());
  if (!perm.granted) return [];
  const res = await withSystemUi(() => ImagePicker.launchCameraAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.9,
    videoMaxDuration: 60,
    exif: false,
  }));
  if (res.canceled) return [];
  return res.assets.map(fromImagePickerAsset);
}

function fromImagePickerAsset(a: ImagePicker.ImagePickerAsset): PrepareInput {
  const isVideo = a.type === "video";
  const mime = a.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
  return {
    uri: a.uri,
    name: a.fileName ?? (isVideo ? "video.mp4" : "photo.jpg"),
    mime,
    kind: isVideo ? "video" : "image",
    width: a.width,
    height: a.height,
    durationMs: a.duration ?? undefined,
  };
}
