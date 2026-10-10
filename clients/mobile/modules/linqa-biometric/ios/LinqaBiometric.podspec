Pod::Spec.new do |s|
  s.name = 'LinqaBiometric'
  s.version = '1.0.0'
  s.summary = 'Linqa biometric-gated hardware signatures'
  s.description = 'Secure Enclave P-256 authorization for LinqaVault and LinqaSend.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Linqa'
  s.homepage = 'https://linqa.app'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
