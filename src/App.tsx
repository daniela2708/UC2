import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from 'react';
import { BottomBar } from './components/Blocks';
import { DefinitionsDrawer } from './components/DefinitionsDrawer';
import { FilterCard } from './components/FilterCard';
import { Disclaimer, Header } from './components/Header';
import { actions, FilterProvider, useFilters } from './lib/filterStore';
import { CategoryItemView } from './views/CategoryItemView';
import { FreshReportView } from './views/FreshReportView';
import { PluCostWatchView } from './views/PluCostWatchView';
import { ShrinkReviewView } from './views/ShrinkReviewView';
import { StoreLossView } from './views/StoreLossView';

/** Shows a generic message to users; details go to the console only. */
class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View failed to render', error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <section className="card app-error" role="alert">
          <h2>Something went wrong</h2>
          <p>This view could not be displayed. Try another filter or reset the filters.</p>
        </section>
      );
    return this.props.children;
  }
}

function Shell() {
  const { state, update } = useFilters();
  const [defs, setDefs] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  const openDefinitions = useCallback((id?: string) => setDefs({ open: true, focus: id ?? null }), []);
  const closeDefinitions = useCallback(() => setDefs((d) => ({ ...d, open: false })), []);

  const view = (() => {
    switch (state.tab) {
      case 'fresh':
        return <FreshReportView openDefinitions={openDefinitions} />;
      case 'shrink':
        return <ShrinkReviewView openDefinitions={openDefinitions} />;
      case 'storeloss':
        return <StoreLossView openDefinitions={openDefinitions} />;
      case 'plu':
        return <PluCostWatchView openDefinitions={openDefinitions} />;
      default:
        return <CategoryItemView openDefinitions={openDefinitions} />;
    }
  })();

  return (
    <>
      <Header onOpenDefinitions={() => openDefinitions()} />
      <Disclaimer />
      <main className="page">
        <FilterCard />
        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${state.tab}`}>
          <ErrorBoundary resetKey={window.location.search}>{view}</ErrorBoundary>
        </div>
      </main>
      <BottomBar
        tab={state.tab}
        onTab={(t) => {
          update(actions.tab(t));
          window.scrollTo({ top: 0 });
        }}
      />
      <DefinitionsDrawer open={defs.open} focusId={defs.focus} onClose={closeDefinitions} />
    </>
  );
}

export default function App() {
  return (
    <FilterProvider>
      <Shell />
    </FilterProvider>
  );
}
