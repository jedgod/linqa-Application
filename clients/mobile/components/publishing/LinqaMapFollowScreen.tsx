// Supplied LinqaMapFollowScreen.tsx, used as written (permission card, Start Directions, live tracking HUD, Stop, no automatic reroute)
// with these changes so it runs in this app:
//  - the Google Maps view (react-native-maps, which needs a Google key and a native build this app does not have) is the Linqa map
//    (Leaflet on OpenStreetMap tiles). The route line, destination pin and live dot are drawn on it and it follows the person;
//  - the route comes from the routing service in ./route (OSRM or native Valhalla) instead of the placeholder address, and when no route can be
//    found it says so instead of drawing a straight line, which would pass for a driving route;
//  - extra props so it can open inside Linqa Discover: autoStart, showDirections, onClose, embedded;
//  - SafeAreaView comes from react-native-safe-area-context, and a duplicated indicator dot is removed.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AppState,
  ActivityIndicator,
  Linking,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { MapFrame } from './LeafletMap';
import { distanceText, durationText, fetchRoute, type DrivingRoute } from './route';

// Type declarations for geo parameters
interface Coordinate {
  latitude: number;
  longitude: number;
}

interface LinqaMapFollowScreenProps {
  destination?: Coordinate;
  /** The address (or place) text. */
  destinationTitle?: string;
  /** The program / event name, shown on the first line above the address. */
  destinationName?: string;
  /** Start directions as soon as the screen opens (the directions icon on a post's map). */
  autoStart?: boolean;
  /** Show the Start Directions controls. */
  showDirections?: boolean;
  /** Close button. Without it the screen has none. */
  onClose?: () => void;
  /** Inside another screen (under its heading) rather than full screen. */
  embedded?: boolean;
}

/** Shows a typed address the way it is normally written: "2817 ruckert av baltimore md 21214" -> "2817 Ruckert Av Baltimore MD 21214". */
export function prettyAddress(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    if (/^[a-z]{2}$/i.test(w) && /^\d{5}(-\d{4})?$/.test(words[i + 1] ?? '')) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

export default function LinqaMapFollowScreen({
  destination = { latitude: 38.8970, longitude: -77.0400 }, // Default fallback to post cords
  destinationTitle = "Linqa Destination",
  destinationName,
  autoStart = false,
  showDirections = true,
  onClose,
  embedded = false
}: LinqaMapFollowScreenProps) {

  // Reactive Core State Hooks
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [staticRoute, setStaticRoute] = useState<DrivingRoute | null>(null);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<Location.PermissionStatus>(Location.PermissionStatus.UNDETERMINED);
  const [locationSubscription, setLocationSubscription] = useState<Location.LocationSubscription | null>(null);
  const alive = useRef(true);

  // Verification pipeline to query system for ongoing hardware access
  const checkCurrentPermissions = async (): Promise<boolean> => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (alive.current) setLocationPermission(status);
    return status === Location.PermissionStatus.GRANTED;
  };

  // ROUTING SERVICE PIPELINE
  const fetchHostedRouteGeometry = async (startPos: Coordinate): Promise<boolean> => {
    setIsLoadingRoute(true);
    setRouteError(null);
    try {
      const route = await fetchRoute(startPos, destination);
      if (!alive.current) return false;
      setStaticRoute(route);
      return true;
    } catch (error) {
      console.error('Navigation service fetch exception: ', error);
      // No fake straight line: say what happened and let the person try again.
      const noRoute = error instanceof Error && (error.message === 'NO_ROUTE' || error.message === 'ROUTE_UNAVAILABLE');
      if (alive.current) setRouteError(noRoute ? 'No driving route was found to this place.' : 'Could not get directions. Check your connection and try again.');
      return false;
    } finally {
      if (alive.current) setIsLoadingRoute(false);
    }
  };

  // HANDLER: Trigger telemetry subscription loops
  const startNavigationSession = async () => {
    const isGranted = await checkCurrentPermissions();

    if (!isGranted) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status);

      // If user forcefully drops access request, jump clean out of process execution loop
      if (status !== Location.PermissionStatus.GRANTED) {
        return;
      }
    }

    setIsNavigating(true);

    try {
      // Pull rapid hardware snapshot coordinate metrics to build route map
      const initialLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const currentStartPoint = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude
      };

      setUserLocation(currentStartPoint);

      // Initialize hosted pipeline query geometry mapping parameters
      const found = await fetchHostedRouteGeometry(currentStartPoint);
      if (!found) { setIsNavigating(false); setUserLocation(null); return; }

      // Start the passive coordinate monitor stream (No text-to-speech loops or audio engines initialized)
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000, // Query position telemetry markers every 2 seconds
          distanceInterval: 5 // Query update events every 5 meters
        },
        (location) => {
          // The map follows this position: the person's dot is moved and the view is kept on it.
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude
          });
        }
      );

      if (!alive.current) { sub.remove(); return; }
      setLocationSubscription(sub);
    } catch (err) {
      console.error('Failed to instantiate passive tracking stream framework: ', err);
      if (alive.current) { setRouteError('Could not find your location. Try again.'); setIsNavigating(false); setUserLocation(null); }
    }
  };

  const stopNavigationSession = () => {
    if (locationSubscription) {
      locationSubscription.remove();
      setLocationSubscription(null);
    }
    setIsNavigating(false);
    setUserLocation(null);
    setRouteError(null);
    setStaticRoute(null); // NO AUTOMATIC REROUTE: Flushing path geometry relies on fully re-pressing trigger actions
  };

  const handleSystemSettingsDeepHandoff = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  // Monitor hardware background focus parameters to capture settings permissions flip states on re-entry
  useEffect(() => {
    checkCurrentPermissions();
    const appStateSubscriber = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkCurrentPermissions();
      }
    });

    return () => {
      appStateSubscriber.remove();
      if (locationSubscription) locationSubscription.remove();
    };
  }, [locationSubscription]);

  useEffect(() => {
    alive.current = true;
    if (autoStart && showDirections) void startNavigationSession();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.viewLayoutContainer} edges={embedded ? [] : ['top', 'bottom']}>
      {/* NO AUTOMATIC REROUTE: the route line stays exactly as it was drawn when directions started */}
      <MapFrame
        latitude={destination.latitude}
        longitude={destination.longitude}
        height="100%"
        zoom={14}
        interactive
        route={isNavigating ? staticRoute : null}
        me={isNavigating ? userLocation : null}
      />

      {/* Where this is: the destination's name, so it is never forgotten */}
      <View style={styles.placeLabel} pointerEvents="none">
        <Ionicons name="location" size={18} color="#D84A59" />
        <View style={{ flexShrink: 1 }}>
          {destinationName ? <Text numberOfLines={1} style={styles.placeLabelText}>{destinationName}</Text> : null}
          <Text numberOfLines={2} style={destinationName ? styles.placeLabelAddress : styles.placeLabelText}>{prettyAddress(destinationTitle)}</Text>
        </View>
      </View>
      {onClose ? (
        <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close map" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={26} color="#17151C" />
        </TouchableOpacity>
      ) : null}

      {/* FIXED DYNAMIC CONTEXT FLOATING OVERLAY HUD CONTAINER */}
      {showDirections ? (
      <View style={styles.floatingHudWrapper}>

        {/* CONDITION 4: LOCATION PROMPT PERMISSION BLOCK INTERCEPTOR */}
        {locationPermission === Location.PermissionStatus.DENIED && (
          <View style={styles.noticePromptCard}>
            <Text style={styles.noticeTitle}>Location Access Disabled 📍</Text>
            <Text style={styles.noticeBody}>
              Linqa needs permission to view your device position telemetry coordinates on the map workspace framework to actively align path tracking overlays.
            </Text>

            <View style={styles.splitButtonRow}>
              <TouchableOpacity style={styles.secondaryActionBtn} onPress={handleSystemSettingsDeepHandoff}>
                <Text style={styles.secondaryActionText}>Open Settings</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.primaryActionButton} onPress={startNavigationSession}>
                <Text style={styles.buttonTextText}>Try again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ACTIVE DRIVING PIPELINE DISPLAY CONTROLLER ENGINE STATES */}
        {locationPermission !== Location.PermissionStatus.DENIED && (
          <>
            {routeError && !isNavigating ? (
              <View style={[styles.noticePromptCard, { marginBottom: 10 }]}>
                <Text style={styles.noticeBody}>{routeError}</Text>
              </View>
            ) : null}
            {!isNavigating ? (
              <TouchableOpacity style={styles.primaryActionButton} onPress={startNavigationSession}>
                <Text style={styles.buttonTextText}>{routeError ? 'Try again' : '▶ Start Directions'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.activeRouteStatusCard}>
                {isLoadingRoute ? (
                  <View style={styles.loadingRouteHUDPanel}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.loadingTextLabel}>Resolving route...</Text>
                  </View>
                ) : (
                  <View style={styles.trackingActiveRow}>
                    <View style={styles.livePulseIndicatorGreen} />
                    <View>
                      <Text style={styles.trackingStatusText}>Tracking Active</Text>
                      {staticRoute ? <Text style={styles.trackingSubText}>{durationText(staticRoute.seconds)} · {distanceText(staticRoute.meters)}</Text> : null}
                    </View>
                    <TouchableOpacity style={styles.stopButton} onPress={stopNavigationSession}>
                      <Text style={styles.stopButtonText}>Stop</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  viewLayoutContainer: {
    flex: 1,
  },
  placeLabel: {
    position: 'absolute', top: 12, left: 16, right: 76, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, elevation: 4,
  },
  placeLabelText: { flexShrink: 1, color: '#17151C', fontWeight: '700', fontSize: 15 },
  placeLabelAddress: { color: '#4B5563', fontSize: 13, marginTop: 1 },
  closeButton: {
    position: 'absolute', top: 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', elevation: 6,
  },
  telemetryDotWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  telemetryDotPulse: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(37, 99, 235, 0.3)',
    position: 'absolute',
  },
  telemetryDotCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  floatingHudWrapper: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  noticePromptCard: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  noticeTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 5,
  },
  noticeBody: {
    fontSize: 14,
    marginBottom: 10,
  },
  splitButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  secondaryActionBtn: {
    backgroundColor: '#e0e0e0',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginRight: 10,
  },
  secondaryActionText: {
    textAlign: 'center',
    color: '#333',
  },
  primaryActionButton: {
    backgroundColor: '#2563eb',
    padding: 10,
    borderRadius: 5,
    flex: 1,
  },
  buttonTextText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  activeRouteStatusCard: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 5,
  },
  loadingRouteHUDPanel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingTextLabel: {
    marginLeft: 10,
    fontSize: 14,
    color: '#2563eb',
  },
  trackingActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  livePulseIndicatorGreen: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e', // green pulse indicator
    marginRight: 10,
  },
  trackingStatusText: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 20,
  },
  trackingSubText: {
    fontSize: 13,
    color: '#4B5563',
  },
  stopButton: {
    backgroundColor: '#ef4444', // red stop button
    paddingVertical: 6,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginLeft: 'auto',
  },
  stopButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
