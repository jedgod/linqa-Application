Pod::Spec.new do |s|
  s.name           = 'ScreenRecordingDetector'
  s.version        = '1.0.0'
  s.summary        = 'Detects screen recording and mirroring for Linqa'
  s.description    = 'Reports UIScreen.isCaptured changes to JavaScript'
  s.author         = ''
  s.homepage       = 'https://example.com'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
