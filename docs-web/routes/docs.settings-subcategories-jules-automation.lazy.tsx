import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesJulesAutomationContent from '../content/docs/settings-subcategories-jules-automation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-jules-automation')({
  component: () => (
    <DocsPage id="settings-subcategories-jules-automation">
      <SettingsSubcategoriesJulesAutomationContent />
    </DocsPage>
  )
})
