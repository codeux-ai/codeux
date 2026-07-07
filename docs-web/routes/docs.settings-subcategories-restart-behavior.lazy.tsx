import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesRestartBehaviorContent from '../content/docs/settings-subcategories-restart-behavior.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-restart-behavior')({
  component: () => (
    <DocsPage id="settings-subcategories-restart-behavior">
      <SettingsSubcategoriesRestartBehaviorContent />
    </DocsPage>
  )
})
