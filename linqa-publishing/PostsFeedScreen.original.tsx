//PostsFeedScreen.tsx
import React, { useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, Dimensions, SafeAreaView, StatusBar } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps'; // Run: npx expo install react-native-maps

// Define TypeScript interfaces for our feed schema
interface Post {
  id: string;
  author: string;
  avatar: string;
  timestamp: string;
  content: string;
  image?: string;
  location: {
    latitude: number;
    longitude: number;
    title: string;
    latitudeDelta: number;
    longitudeDelta: number;
  };
}

export default function PostsFeedScreen() {
  // Mock Data Feed containing regional global publisher updates
  const [posts] = useState<Post[]>([
    {
      id: '1',
      author: 'Le Monde Desk',
      avatar: 'https://unsplash.com',
      timestamp: '12 mins ago',
      content: 'Live update on European technology corridors. Infrastructure maps are shifting rapidly across central zones.',
      location: {
        latitude: 48.8566, // Paris
        longitude: 2.3522,
        title: 'Le Monde HQ',
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    },
    {
      id: '2',
      author: 'PBS NewsHour',
      avatar: 'https://unsplash.com',
      timestamp: '45 mins ago',
      content: 'Field reporting from the coastal climate monitoring arrays. Data anchors successfully compiled into the Vault infrastructure.',
      image: 'https://unsplash.com',
      location: {
        latitude: 38.8951, // Washington D.C.
        longitude: -77.0364,
        title: 'PBS Washington Studio',
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    }
  ]);

  const renderPostItem = ({ item }: { item: Post }) => (
    <View className="bg-white mb-4 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header Profile Frame */}
      <View className="flex-row items-center p-4">
        <Image 
          source={{ uri: item.avatar }} 
          className="w-10 h-10 rounded-full bg-gray-200"
        />
        <div className="flex-1 ml-3">
          <Text className="text-sm font-bold text-gray-900">{item.author}</Text>
          <Text className="text-xs text-gray-400">{item.timestamp}</Text>
        </div>
        <TouchableOpacity className="p-2">
          <Text className="text-gray-400 font-bold">•••</Text>
        </TouchableOpacity>
      </View>

      {/* Main Text Content */}
      <View className="px-4 pb-3">
        <Text className="text-sm leading-relaxed text-gray-800">{item.content}</Text>
      </View>

      {/* Optional Editorial Graphic Embed */}
      {item.image && (
        <Image 
          source={{ uri: item.image }} 
          className="w-full h-48 bg-gray-100" 
          resizeMode="cover"
        />
      )}

      {/* Integrated Location Post Map */}
      <View className="h-44 w-full bg-gray-50 border-t border-gray-100">
        <MapView
          provider={PROVIDER_GOOGLE}
          className="w-full h-full"
          initialRegion={item.location}
          scrollEnabled={false} // Prevents timeline scrolling interference
          zoomEnabled={true}
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Marker 
            coordinate={{ latitude: item.location.latitude, longitude: item.location.longitude }}
            title={item.location.title}
          />
        </MapView>
        
        {/* Dynamic Location Floating HUD Label */}
        <View className="absolute bottom-3 left-3 bg-black/70 px-3 py-1.5 rounded-lg backdrop-blur-md flex-row items-center">
          <View className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
          <Text className="text-white text-xs font-semibold">{item.location.title}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <StatusBar barStyle="dark-content" />
      
      {/* Top Banner Navigation Row */}
      <View className="px-4 py-3 bg-white border-b border-gray-100 flex-row justify-between items-center">
        <Text className="text-xl font-black tracking-tight text-gray-900">Linqa Discover</Text>
        <TouchableOpacity className="p-2 bg-blue-50 rounded-full">
          <Text className="text-blue-600 text-xs font-bold">Map View</Text>
        </TouchableOpacity>
      </View>

      {/* Core Feed Scroll Pipeline */}
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPostItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}