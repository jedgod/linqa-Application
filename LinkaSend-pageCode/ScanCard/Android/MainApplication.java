import com.yourapp.BlinkCardPackage;

@Override
protected List<ReactPackage> getPackages() {
    return Arrays.<ReactPackage>asList(
        new MainReactPackage(),
        new BlinkCardPackage() // add this line
    );
}