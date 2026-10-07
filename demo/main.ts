import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import Demo from './Demo.vue'

// The host app owns the vue-i18n instance; the editor follows its locale
// without being told (switch the language in the demo header).
const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: {} })

createApp(Demo).use(i18n).mount('#app')
