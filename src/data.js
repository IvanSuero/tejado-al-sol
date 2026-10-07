// Municipios de España (GeoNames, vía all-the-cities) y provincias (códigos INE).
const allCities = require('all-the-cities');

const PROVINCES = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz',
  '07': 'Illes Balears', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón',
  '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña', '16': 'Cuenca', '17': 'Girona', '18': 'Granada',
  '19': 'Guadalajara', '20': 'Gipuzkoa', '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León',
  '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia',
  '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra',
  '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia', '41': 'Sevilla',
  '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid',
  '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
};

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’·]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
// "els Pallaresos" → "Els Pallaresos"; "l'Hospitalet" → "L'Hospitalet"
function displayName(n) { return n.charAt(0).toUpperCase() + n.slice(1); }

function haversine(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const NAME_FIX = { 'Cadiz': 'Cádiz', 'Palma': 'Palma', 'Donostia / San Sebastián': 'Donostia-San Sebastián' };

function loadMunicipalities() {
  const out = [];
  const seen = new Set();
  const list = allCities
    .filter(c => c.country === 'ES' && ['PPLA', 'PPLA2', 'PPLA3', 'PPLC'].includes(c.featureCode) && c.muni && PROVINCES[c.muni.slice(0, 2)])
    .sort((a, b) => b.population - a.population);
  for (const c of list) {
    const provCode = c.muni.slice(0, 2);
    const prov = PROVINCES[provCode];
    const name = NAME_FIX[c.name] || displayName(c.name);
    const provSlug = slugify(prov);
    let slug = slugify(name);
    if (!slug) continue;
    if (seen.has(provSlug + '/' + slug)) slug += '-' + c.cityId;
    seen.add(provSlug + '/' + slug);
    const [lon, lat] = c.loc.coordinates;
    out.push({
      id: String(c.cityId), ine: c.muni, name, prov, provCode, provSlug, slug,
      path: `${provSlug}/${slug}/`, lat: +lat.toFixed(4), lon: +lon.toFixed(4), pop: c.population,
    });
  }
  return out;
}

function nearest(target, list, n) {
  return list.filter(x => x !== target).map(x => ({ x, km: haversine(target, x) }))
    .sort((a, b) => a.km - b.km).slice(0, n);
}

module.exports = { PROVINCES, loadMunicipalities, slugify, haversine, nearest };
