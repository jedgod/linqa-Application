import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  SafeAreaView, 
  StyleSheet, 
  AppState, 
  ActivityIndicator, 
  Linking,
  Platform 
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';

// Type declarations for geo parameters
interface Coordinate {
  latitude: number;
  longitude: number;
}

interface LinqaMapFollowScreenProps {
  destination?: Coordinate;
  destinationTitle?: string;
}

export default function LinqaMapFollowScreen({ 
  destination = { latitude: 38.8970, longitude: -77.0400 }, // Default fallback to post cords
  destinationTitle = "Linqa Destination" 
}: LinqaMapFollowScreenProps) {
  
  const mapRef = useRef<MapView | null>(null);
  
  // Reactive Core State Hooks
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [staticRoute, setStaticRoute] = useState<Coordinate[]>([]);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [locationPermission, setLocationPermission] = useState<Location.PermissionStatus>(Location.PermissionStatus.UNDETERMINED);
  const [locationSubscription, setLocationSubscription] = useState<Location.LocationSubscription | null>(null);

  // Verification pipeline to query system for ongoing hardware access
  const checkCurrentPermissions = async (): Promise<boolean> => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationPermission(status);
    return status === Location.PermissionStatus.GRANTED;
  };

  // HOSTED ROUTING SERVICE PIPELINE INTERCEPTOR
  const fetchHostedRouteGeometry = async (startPos: Coordinate) => {
    setIsLoadingRoute(true);
    try {
      // Connects directly to your enterprise hosted Valhalla / OSRM server instance cluster
      const HOSTED_ROUTING_ENDPOINT = `https://linqa-app.com`;
      const coordinatesQuery = `${startPos.longitude},${startPos.latitude};${destination.longitude},${destination.latitude}`;
      
      const response = await fetch(`${HOSTED_ROUTING_ENDPOINT}${coordinatesQuery}?overview=full&geometries=geojson`);
      
      if (!response.ok) throw new Error(`Server network response error code: ${response.status}`);
      
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        // Decode the GeoJSON array coordinates layout payload: [longitude, latitude] -> {latitude, longitude}
        const parsedCoords: Coordinate[] = data.routes[0].geometry.coordinates.map((coord: number[]) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));
        setStaticRoute(parsedCoords);
      } else {
        // Safe fallback direct vector connection straight line if geometry payload format fails
        setStaticRoute([startPos, destination]);
      }
    } catch (error) {
      console.error('Hosted navigation service fetch exception: ', error);
      // Fallback line preserves base navigation execution block during service outage
      setStaticRoute([startPos, destination]);
    } finally {
      setIsLoadingRoute(false);
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
      await fetchHostedRouteGeometry(currentStartPoint);

      // Start the passive coordinate monitor stream (No text-to-speech loops or audio engines initialized)
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000, // Query position telemetry markers every 2 seconds
          distanceInterval: 5 // Query update events every 5 meters
        },
        (location) => {
          const currentCoordinates = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude
          };
          
          setUserLocation(currentCoordinates);

          // VIEWPORT ALIGNMENT TRACK: Smoothly track user frame updates inside map view center context
          if (mapRef.current) {
            mapRef.current.animateToRegion({
              ...currentCoordinates,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            }, 1000);
          }
        }
      );

      setLocationSubscription(sub);
    } catch (err) {
      console.error('Failed to instantiate passive tracking stream framework: ', err);
      setIsNavigating(false);
    }
  };

  const stopNavigationSession = () => {
    if (locationSubscription) {
      locationSubscription.remove();
      setLocationSubscription(null);
    }
    setIsNavigating(false);
    setUserLocation(null);
    setStaticRoute([]); // NO AUTOMATIC REROUTE: Flushing path geometry relies on fully re-pressing trigger actions
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

  return (
    <SafeAreaView style={styles.viewLayoutContainer}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.mapViewport}
        initialRegion={{
          latitude: destination.latitude,
          longitude: destination.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {/* NO AUTOMATIC REROUTE: Polyline static geometry remains completely frozen on setup layout arrays */}
        {staticRoute.length > 0 && (
          <Polyline 
            coordinates={staticRoute} 
            strokeWidth={5} 
            strokeColor="#2563eb" 
            lineJoin="round"
          />
        )}

        {/* Core Destination Anchor Target Pin */}
        <Marker coordinate={destination} title={destinationTitle} />

        {/* Custom Telemetry Hardware Position Pin Marker Indicator Layer */}
        {userLocation && (
          <Marker coordinate={userLocation} title="Your Live Location">
            <View style={styles.telemetryDotWrapper}>
              <View style={styles.telemetryDotPulse} />
              <View style={styles.telemetryDotCore} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* FIXED DYNAMIC CONTEXT FLOATING OVERLAY HUD CONTAINER */}
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
            {!isNavigating ? (
              <TouchableOpacity style={styles.primaryActionButton} onPress={startNavigationSession}>
                <Text style={styles.buttonTextText}>▶ Start Directions</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.activeRouteStatusCard}>
                {isLoadingRoute ? (
                  <View style={styles.loadingRouteHUDPanel}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.loadingTextLabel}>Resolving hosted pipeline paths...</Text>
                  </View>
                ) : (
                  <View style={styles.trackingActiveRow}>
                    <View style={styles.livePulseIndicatorGreen} />
                    <View style={styles.livePulseIndicatorGreen} />
<Text style={styles.trackingStatusText}>Tracking Active</Text>
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
</SafeAreaView>
);
}

// Example styles object (you will need to adjust or add your own styles)
const styles = StyleSheet.create({
  viewLayoutContainer: {
    flex: 1,
  },
  mapViewport: {
    flex: 1,
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
  stopButton: {
    backgroundColor: '#ef4444', // red stop button
    paddingVertical: 6,
    paddingHorizontal: 15,
    borderRadius: 5,
  },
  stopButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});