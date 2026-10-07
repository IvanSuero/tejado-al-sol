// Configuración del sitio.
module.exports = {
  siteUrl: process.env.SITE_URL || 'https://ivansuero.github.io',
  // GitHub Pages sin dominio propio: '/nombre-del-repo/'. Con dominio propio: '/'.
  basePath: process.env.BASE_PATH || '/tejado-al-sol/',
  siteName: 'Tejado al Sol',
  tagline: 'Simula tus placas solares sobre tu propio tejado',
  adsenseClient: process.env.ADSENSE_CLIENT || '',
  contactEmail: process.env.CONTACT_EMAIL || '', // pon aquí un correo de contacto antes de pedir AdSense
  googleVerification: process.env.GOOGLE_VERIFICATION || '',
};
