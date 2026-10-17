Pod::Spec.new do |s|
  s.name = 'LinqaBlinkCard'
  s.version = '1.0.0'
  s.summary = 'Linqa BlinkCard card scanning'
  s.description = 'On-device card scanning for LinqaSend add-card using the Microblink BlinkCard SDK.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Linqa'
  s.homepage = 'https://linqa.app'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  # BlinkCard ships only as a Swift package (no CocoaPods release); React Native's spm_dependency links it.
  spm_dependency(s, url: 'https://github.com/microblink/blinkcard-ios.git', requirement: { kind: 'upToNextMajorVersion', minimumVersion: '3001.0.0' }, products: ['BlinkCardUX'])
end
