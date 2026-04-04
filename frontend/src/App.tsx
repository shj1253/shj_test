import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import LivePage from './pages/LivePage'
import TestPage from './pages/TestPage'
import MetricsPage from './pages/MetricsPage'
import LabelReviewPage from './pages/LabelReviewPage'
import ModelComparePage from './pages/ModelComparePage'
import TrainingPage from './pages/TrainingPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LivePage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route path="/labels" element={<LabelReviewPage />} />
          <Route path="/compare" element={<ModelComparePage />} />
          <Route path="/training" element={<TrainingPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
