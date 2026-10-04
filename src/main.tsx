import {App, ToastContainer} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {CluePage} from './pages/CluePage';
import {TeacherDecksPage} from './pages/TeacherDecksPage';
import {TeacherConsolePage} from './pages/TeacherConsolePage';
import {TeacherProjectorPage} from './pages/TeacherProjectorPage';
import './styles.css';

function Root() {
  return (
    <BrowserRouter>
      <ReactRouterNavigationProvider>
        <App>
          {/* Required once at the root: without it Toast.show() silently
              renders nothing (projector button feedback depends on it). */}
          <ToastContainer />
          <ReactRouterPageTransition>
            {({location}) => (
              <Routes location={location}>
                {/* Glasses: pure display. The deck comes only from synced
                    teacher state -- deck selection lives on the console. */}
                <Route path="/" element={<CluePage />} />
                {/* Legacy install URL; the glasses no longer takes a deck. */}
                <Route path="/deck/:deckId" element={<Navigate to="/" replace />} />
                <Route path="/teacher" element={<TeacherDecksPage />} />
                <Route path="/teacher/:deckId" element={<TeacherConsolePage />} />
                <Route
                  path="/teacher/:deckId/projector"
                  element={<TeacherProjectorPage />}
                />
              </Routes>
            )}
          </ReactRouterPageTransition>
        </App>
      </ReactRouterNavigationProvider>
    </BrowserRouter>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');

createRoot(root).render(<Root />);
