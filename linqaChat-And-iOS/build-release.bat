@echo off
setlocal
cd /d "%~dp0"
call create-keystore.bat
if errorlevel 1 exit /b 1

set "APP_ANDROID=%~dp0..\..\android"
if not exist "%APP_ANDROID%\gradlew.bat" (
  echo Put this folder's properties next to android\gradlew.bat, then run from the Expo android directory.
  echo Expected gradlew at %APP_ANDROID%\gradlew.bat
  exit /b 1
)

copy /Y "%~dp0linqa-signing.properties" "%APP_ANDROID%\linqa-signing.properties" >nul
copy /Y "%~dp0linqa-release.keystore" "%APP_ANDROID%\linqa-release.keystore" >nul

pushd "%APP_ANDROID%"
call gradlew.bat --stop
call gradlew.bat clean :app:assembleRelease -x lint -x test --refresh-dependencies
set "CODE=%ERRORLEVEL%"
popd
if not "%CODE%"=="0" exit /b %CODE%

echo Release APK is under android\app\build\outputs\apk\release
echo Uninstall com.linqa from the Galaxy before adb install, or the signature will not match.
exit /b 0
