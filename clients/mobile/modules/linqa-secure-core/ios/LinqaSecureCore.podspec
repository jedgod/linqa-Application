require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LinqaSecureCore'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'Linqa'
  s.homepage       = 'https://linqa.invalid'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The Swift bridge plus the UniFFI-generated Swift bindings for the Rust core.
  s.source_files = '*.swift', 'linqa_coreFFI.h'
  # The compiled Rust core (aarch64-apple-ios). Built by build-core.sh on a macOS machine; absent on Windows.
  s.vendored_libraries = 'libs/liblinqa_core.a'
  s.preserve_paths = 'linqa_coreFFI.modulemap', 'linqa_coreFFI.h', 'libs/*'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'SWIFT_INCLUDE_PATHS' => '$(PODS_TARGET_SRCROOT)',
    'OTHER_LDFLAGS' => '-lc++'
  }
end
