@echo off
setlocal
cd /d "%~dp0"
if exist linqa-release.keystore (
  echo Keystore already exists. Not overwriting.
  exit /b 0
)
keytool -genkeypair -v ^
  -storetype PKCS12 ^
  -keystore linqa-release.keystore ^
  -alias linqa ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass linqa-local-release ^
  -keypass linqa-local-release ^
  -dname "CN=Linqa Local, OU=Mobile, O=Linqa, L=Bowie, ST=MD, C=US"
if errorlevel 1 exit /b 1
echo Created linqa-release.keystore
echo Uninstall the current app before installing this build. Local phone data will be lost.
