import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesOnboardingContent from '../content/docs/settings-subcategories-onboarding.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-onboarding')({
  component: () => (
    <DocsPage id="settings-subcategories-onboarding">
      <SettingsSubcategoriesOnboardingContent />
    </DocsPage>
  )
})
