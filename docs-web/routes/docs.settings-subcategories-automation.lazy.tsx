import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesAutomationContent from '../content/docs/settings-subcategories-automation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-automation')({
  component: () => (
    <DocsPage id="settings-subcategories-automation">
      <SettingsSubcategoriesAutomationContent />
    </DocsPage>
  )
})
