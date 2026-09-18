import AppBody from "./AppBody";
import { TrackingProvider } from "./tracking";

export default function App() {
  return (
    <TrackingProvider>
      <AppBody />
    </TrackingProvider>
  );
}
