import { LinqaRuntimeProvider } from "../runtime/RuntimeProvider";
import { RuntimeStatusBanner } from "../runtime/RuntimeStatusBanner";

export function AppIntegrationShell({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <LinqaRuntimeProvider>
      <RuntimeStatusBanner />
      {children}
    </LinqaRuntimeProvider>
  );
}
