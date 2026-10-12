Pod::Spec.new do |s|
  s.name           = 'LinqaCallNative'
  s.version        = '1.0.0'
  s.summary        = 'Linqa call helpers: background blur, PushKit to CallKit, screen-share stop'
  s.description    = s.summary
  s.author         = 'Linqa'
  s.homepage       = 'https://linqa.app'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'react-native-webrtc'
  s.dependency 'RNCallKeep'

  s.frameworks = 'Vision', 'CoreImage', 'PushKit', 'CallKit'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
  # No public headers on purpose: the .m files declare their classes inline,
  # so nothing from react-native-webrtc leaks into this module's umbrella.
  s.source_files = '*.{m,swift}'
end
