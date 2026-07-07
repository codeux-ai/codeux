import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesWorkerLearningsInstructionContent from '../content/docs/settings-subcategories-worker-learnings-instruction.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-worker-learnings-instruction')({
  component: () => (
    <DocsPage id="settings-subcategories-worker-learnings-instruction">
      <SettingsSubcategoriesWorkerLearningsInstructionContent />
    </DocsPage>
  )
})
