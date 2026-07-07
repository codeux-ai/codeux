import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesWatchLoopContent from '../content/docs/settings-subcategories-watch-loop.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-watch-loop')({
  component: () => (
    <DocsPage id="settings-subcategories-watch-loop">
      <SettingsSubcategoriesWatchLoopContent />
    </DocsPage>
  )
})
