/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NetworkDashboard } from './components/NetworkDashboard';

export default function App() {
  return (
    <main className="runescan-shell min-h-screen selection:bg-scan-accent selection:text-white">
      <NetworkDashboard />
    </main>
  );
}
