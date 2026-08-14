import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  BrowserCoreRuntimeProbe,
  EnvironmentRuntimeFlags,
  HttpServerRuntimeProbe,
  LocalAuthRuntimeProbe
} from "./DefaultRuntimeAdapters";
import { RuntimeController } from "./RuntimeController";
import type { RuntimeSnapshot } from "./types";

interface RuntimeContextValue {
  snapshot: RuntimeSnapshot | null;
  loading: boolean;
  refresh(): Promise<void>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function LinqaRuntimeProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const controller = useMemo(
    () =>
      new RuntimeController(
        new HttpServerRuntimeProbe(
          import.meta.env.VITE_LINQA_API_URL ?? "http://127.0.0.1:8080"
        ),
        new BrowserCoreRuntimeProbe(),
        new LocalAuthRuntimeProbe(),
        new EnvironmentRuntimeFlags()
      ),
    []
  );

  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setSnapshot(await controller.inspect());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();

    const onRuntimeChanged = () => void refresh();
    window.addEventListener("linqa:runtime-changed", onRuntimeChanged);

    return () => {
      window.removeEventListener("linqa:runtime-changed", onRuntimeChanged);
    };
  }, []);

  return (
    <RuntimeContext.Provider value={{ snapshot, loading, refresh }}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useLinqaRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) {
    throw new Error("useLinqaRuntime must be used inside LinqaRuntimeProvider");
  }
  return value;
}
