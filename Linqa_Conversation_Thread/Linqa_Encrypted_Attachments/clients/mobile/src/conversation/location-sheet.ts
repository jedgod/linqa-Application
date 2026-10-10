/**
 * Map location sheet. Not a navigation app.
 * Shows a share pin and a request for the other person's live location.
 * Coordinates leave the device only after accept, and only inside an envelope.
 */
export interface MapPin {
  latitude: number;
  longitude: number;
  label: string;
}

export interface LocationSheetState {
  myPin?: MapPin;
  peerPin?: MapPin;
  requestState: "IDLE" | "REQUESTED" | "SHARING" | "DECLINED";
}

export function regionFor(pins: MapPin[]) {
  if (pins.length === 0) return { latitude: 0, longitude: 0, latitudeDelta: 40, longitudeDelta: 40 };
  const lat = pins.reduce((sum, pin) => sum + pin.latitude, 0) / pins.length;
  const lng = pins.reduce((sum, pin) => sum + pin.longitude, 0) / pins.length;
  return { latitude: lat, longitude: lng, latitudeDelta: 0.08, longitudeDelta: 0.08 };
}

export function canSendPin(pin?: MapPin): pin is MapPin {
  return !!pin && pin.latitude >= -90 && pin.latitude <= 90 && pin.longitude >= -180 && pin.longitude <= 180;
}
