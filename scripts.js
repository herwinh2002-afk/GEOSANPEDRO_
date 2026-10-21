// ======================================================
// CONFIGURACIÃ“N DEL MAPA
// ======================================================

var map = L.map('map', {
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
    maxZoom: 20,
    minZoom: 2
}).setView([6.24, -75.58], 13);


var themeButton = document.getElementById('theme-button');
var savedTheme = localStorage.getItem('geovisor-theme');
if (savedTheme === 'dark') document.body.dataset.theme = 'dark';
if (themeButton) {
    function updateThemeButton() {
        var isDark = document.body.dataset.theme === 'dark';
        themeButton.setAttribute('aria-pressed', String(isDark));
        themeButton.textContent = isDark ? 'Modo dÃ­a' : 'Modo noche';
        themeButton.title = isDark ? 'Activar modo dÃ­a' : 'Activar modo noche';
    }
    updateThemeButton();
    themeButton.addEventListener('click', function () {
        var isDark = document.body.dataset.theme !== 'dark';
        document.body.dataset.theme = isDark ? 'dark' : 'light';
        localStorage.setItem('geovisor-theme', isDark ? 'dark' : 'light');
        updateThemeButton();
    });
}

L.control.scale({
    position: 'bottomright',
    imperial: false
}).addTo(map);

var mapBounds = L.latLngBounds([
    [6.08, -75.72],
    [6.38, -75.46]
]);

// ======================================================
// MAPA BASE - ESRI WORLD IMAGER
// ======================================================

var Esri_WorldImagery = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
        attribution:
            'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, ' +
            'AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, ' +
            'and the GIS User Community'
    }
);

var CartoDB_Voyager = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd'
    }
);

// Mostrar el mapa base al iniciar
Esri_WorldImagery.addTo(map);


// ======================================================
// GRUPO GENERAL DE CAPAS
// ======================================================

var capas = {};
var capasDeUsuario = L.featureGroup().addTo(map);


// ======================================================
// FUNCIÃ“N PARA MOSTRAR LOS ATRIBUTOS DEL SHAPEFILE
// ======================================================

function mostrarAtributos(feature, layer) {

    var contenido = document.createElement('pre');

    contenido.textContent =
        Object.entries(feature.properties || {})
            .map(function ([campo, valor]) {
                return campo + ': ' + valor;
            })
            .join('\n');

    layer.bindPopup(contenido);
}


// ======================================================
// CARGAR SHAPEFILE .ZIP
// ======================================================

function cargarShapefile(ruta, nombre, opciones) {

    opciones = opciones || {};

    var grupo = new L.Shapefile(ruta, {
        onEachFeature: mostrarAtributos,
        style: opciones.style || {
            color: '#0f766e',
            weight: 2,
            opacity: 0.9,
            fillOpacity: 0.18
        }
    });

    capas[nombre] = grupo;
    grupo.on('data:loaded', function () {
        if (typeof attributeDialog !== 'undefined' && !attributeDialog.hidden && attributeLayerSelect.value === nombre) {
            renderAttributeTable(nombre);
        }
    });

    if (nombre === 'Límites San Pedro') {
        grupo.once('data:loaded', function () {
            var limitesMunicipales = grupo.getBounds();
            if (limitesMunicipales.isValid()) {
                map.fitBounds(limitesMunicipales, {
                    padding: [32, 32],
                    maxZoom: 14
                });
            }
        });
    }

    if (opciones.visible !== false) {
        grupo.addTo(map);
    }

    return grupo;
}


// ======================================================
// CARGA DE CAPAS VECTORIALES DE LA CARPETA date
// ======================================================

// Coloca aquÃ­ los nombres de tus archivos ZIP.
//
// Ejemplo:
//
// var expansion = cargarShapefile(
//     'data/AREA_EXPANSION_ROBLEDO_43262.zip',
//     'Ãrea de expansiÃ³n'
// );

cargarShapefile(
    'date/Limites_San_pedro.zip',
    'Límites San Pedro',
    {
        style: {
            color: '#0f766e',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.12
        }
    }
);

cargarShapefile(
    'date/Limite_urbano.zip',
    'Límite urbano',
    {
        visible: false,
        style: {
            color: '#7c3aed',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.22
        }
    }
);

cargarShapefile(
    'date/Pomca.zip',
    'POMCA',
    {
        visible: false,
        style: {
            color: '#dc2626',
            weight: 2,
            opacity: 0.9,
            fillOpacity: 0.18
        }
    }
);


// ======================================================
// FUNCIÃ“N PARA CARGAR GEOTIFF
// ======================================================

var limitesRasters = L.latLngBounds();


function cargarGeoTiff(ruta, nombre, opciones) {

    opciones = opciones || {};

    if (window.location.protocol === 'file:') {
        console.warn('El raster "' + nombre + '" no se puede cargar desde archivo local. Sirve la carpeta con un servidor HTTP (por ejemplo: python -m http.server 8000) y vuelve a abrir la pÃ¡gina.');
        setStatus('Abre la app desde un servidor local para ver los rasters.');
        return L.layerGroup();
    }

    var grupo = L.layerGroup();

    capas[nombre] = grupo;

    fetch(ruta)

        .then(function (response) {

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            return response.arrayBuffer();
        })

        .then(function (buffer) {

            return parseGeoraster(buffer, {
                readOnDemand: true
            });

        })

        .then(function (georaster) {

            var hasColorBands = georaster.numberOfRasters >= 3;
            var rasterMin = georaster.mins && georaster.mins[0];
            var rasterMax = georaster.maxs && georaster.maxs[0];
            var rasterRange = rasterMax - rasterMin;

            // Algunos GeoTIFF de una sola banda contienen elevaciones o clases,
            // no valores RGBA de 0 a 65535. Normalizar contra sus estadÃ­sticas
            // evita que se dibujen casi transparentes.
            if (!Number.isFinite(rasterRange) || rasterRange <= 0) {
                rasterMin = 0;
                rasterRange = 255;
            }

            var capa = new GeoRasterLayer({
                georaster: georaster,
                resolution: 256,
                opacity: opciones.opacity !== undefined ? opciones.opacity : 0.9,
                pixelValuesToColorFn: function (values) {
                    if (values.some(function (value) {
                        return value == null || Number.isNaN(value);
                    })) {
                        return null;
                    }

                    if (values.length > 3 && values[3] === 0) {
                        return null;
                    }

                    if (!hasColorBands) {
                        var value = values[0];

                        if (opciones.fondoNegro && value <= 5) {
                            return null;
                        }

                        if (opciones.clases) {
                            var clase = opciones.clases[Math.round(value)];
                            return clase || null;
                        }

                        if (opciones.rampa) {
                            var indice;
                            if (opciones.cortes) {
                                indice = 0;
                                while (indice < opciones.cortes.length - 1 && value >= opciones.cortes[indice + 1]) {
                                    indice++;
                                }
                            } else {
                                var intensidad = Math.max(0, Math.min(1, (value - rasterMin) / rasterRange));
                                indice = Math.min(opciones.rampa.length - 1,
                                    Math.floor(intensidad * opciones.rampa.length));
                            }
                            return opciones.rampa[indice];
                        }

                        var intensidad = Math.max(0, Math.min(1, (value - rasterMin) / rasterRange));
                        return 'rgba(15, 118, 110, ' + (0.25 + intensidad * 0.75) + ')';
                    }

                    var r = values[0];
                    var g = values[1];
                    var b = values[2];

                    if (opciones.ycbcr) {
                        var y = values[0];
                        var cb = values[1] - 128;
                        var cr = values[2] - 128;

                        r = Math.round(y + 1.402 * cr);
                        g = Math.round(y - 0.34414 * cb - 0.71414 * cr);
                        b = Math.round(y + 1.772 * cb);
                    }

                    if (opciones.fondoNegro && r <= 5 && g <= 5 && b <= 5) {
                        return null;
                    }

                    if (values.length > 3) {
                        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (values[3] / 255) + ')';
                    }

                    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
                }
            });

            grupo.addLayer(capa);
            limitesRasters.extend(capa.getBounds());

            if (typeof attributeDialog !== 'undefined' && !attributeDialog.hidden && attributeLayerSelect.value === nombre) {
                renderAttributeTable(nombre);
            }

            if (opciones.visible !== false) {
                grupo.addTo(map);
            }
        })

        .catch(function (error) {
            console.error('No se pudo cargar ' + ruta + ':', error);
            setStatus('No se pudo cargar el raster ' + nombre + '. Revisa que la app estÃ© en un servidor local y que el archivo exista.');
        });

    return grupo;
}


// ======================================================
// CARGAR LOS ARCHIVOS TIF DE LA CARPETA date
// ======================================================

cargarGeoTiff(
    'date/DEM_San_pedro_SRTM30m.tif',
    'Modelo Digital de Elevación',
    {
        opacity: 0.8,
        visible: false,
        // ClasificaciÃ³n hipsomÃ©trica: verde (bajo), amarillo/ocre (medio),
        // marrÃ³n (alto). Los cortes se basan en el rango 0â€“3029 m del DEM.
        cortes: [0, 500, 1000, 1500, 2000, 2500, 3000],
        rampa: ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fdae61', '#d66b36', '#7f3b08']
    }
);

cargarGeoTiff(
    'date/Pendientes_Clase_IGAC_San_pedro.tif',
    'Pendientes IGAC',
    {
        opacity: 0.8,
        visible: false,
        clases: {
            1: '#1a9850',
            2: '#91cf60',
            3: '#d9ef8b',
            4: '#fee08b',
            5: '#fc8d59',
            6: '#d73027',
            7: '#762a83'
        }
    }
);


// ======================================================
// CONTROL DE CAPAS
// ======================================================

var basemaps = {
    'Imágenes Esri': Esri_WorldImagery,
    'Mapa CartoDB': CartoDB_Voyager
};

var overlays = Object.assign({}, capas, {
    'Elementos creados': capasDeUsuario
});

var layerControl = L.control.layers(
    basemaps,
    overlays,
    {
        collapsed: false,
        position: 'topright'
    }
).addTo(map);

// Encabezado y bÃºsqueda para localizar rÃ¡pidamente cualquier capa.
var layerPanel = layerControl.getContainer();
var layerPanelHeader = L.DomUtil.create('div', 'layer-panel-header');
layerPanelHeader.innerHTML = '<strong>Capas del mapa</strong><span>Activa o desactiva la informaciÃ³n</span>';
layerPanel.insertBefore(layerPanelHeader, layerPanel.firstChild);

var layerSearch = L.DomUtil.create('input', 'layer-panel-search');
layerSearch.type = 'search';
layerSearch.placeholder = 'Buscar una capaâ€¦';
layerSearch.setAttribute('aria-label', 'Buscar una capa');
layerPanel.insertBefore(layerSearch, layerPanelHeader.nextSibling);

var layerSectionHeadings = layerPanel.querySelectorAll('.leaflet-control-layers-base, .leaflet-control-layers-overlays');
['Mapas base', 'Capas temáticas'].forEach(function (title, index) {
    var section = layerSectionHeadings[index];
    if (!section) return;
    var heading = L.DomUtil.create('button', 'layer-section-title');
    heading.type = 'button';
    heading.textContent = '- ' + title;
    heading.setAttribute('aria-expanded', 'true');
    section.insertBefore(heading, section.firstChild);
    heading.addEventListener('click', function () {
        var collapsed = section.classList.toggle('is-collapsed');
        heading.setAttribute('aria-expanded', String(!collapsed));
        heading.textContent = (collapsed ? '+ ' : '- ') + title;
    });
});
layerSearch.addEventListener('input', function () {
    var query = layerSearch.value.trim().toLocaleLowerCase('es');
    layerSectionHeadings.forEach(function (section) { section.classList.toggle('searching', Boolean(query)); });
    layerPanel.querySelectorAll('.leaflet-control-layers-base label, .leaflet-control-layers-overlays label').forEach(function (label) {
        label.hidden = !label.textContent.toLocaleLowerCase('es').includes(query);
    });
    layerSectionHeadings.forEach(function (section) {
        section.hidden = !section.querySelector('label:not([hidden])');
    });
    var separator = layerPanel.querySelector('.leaflet-control-layers-separator');
    if (separator) separator.hidden = query !== '' && layerSectionHeadings[0].hidden;
});
L.DomEvent.disableClickPropagation(layerSearch);
L.DomEvent.disableScrollPropagation(layerSearch);

var attributeTableButton = L.DomUtil.create('button', 'attribute-table-button');
attributeTableButton.type = 'button';
attributeTableButton.textContent = 'Tabla de atributos';
attributeTableButton.setAttribute('aria-haspopup', 'dialog');
layerPanel.insertBefore(attributeTableButton, layerSearch.nextSibling);

var attributeDialog = document.createElement('section');
attributeDialog.className = 'attribute-dialog';
attributeDialog.setAttribute('role', 'dialog');
attributeDialog.setAttribute('aria-modal', 'true');
attributeDialog.setAttribute('aria-labelledby', 'attribute-dialog-title');
attributeDialog.hidden = true;
attributeDialog.innerHTML = '<div class="attribute-dialog-card"><header class="attribute-dialog-header"><div><h2 id="attribute-dialog-title">Tabla de atributos</h2><p>Consulta los datos de una capa</p></div><button type="button" class="attribute-dialog-close" aria-label="Cerrar">×</button></header><label class="attribute-layer-label">Capa<select class="attribute-layer-select"></select></label><div class="attribute-table-wrap"></div></div>';
document.body.appendChild(attributeDialog);

var attributeLayerSelect = attributeDialog.querySelector('.attribute-layer-select');
var attributeTableWrap = attributeDialog.querySelector('.attribute-table-wrap');

function appendAttributeCell(row, value, tagName) {
    var cell = document.createElement(tagName || 'td');
    cell.textContent = value == null ? '' : String(value);
    row.appendChild(cell);
}

function renderAttributeTable(layerName) {
    attributeTableWrap.replaceChildren();
    var selectedLayer = capas[layerName];
    if (!selectedLayer) return;

    var features = [];
    var raster = null;
    if (selectedLayer.eachLayer) {
        selectedLayer.eachLayer(function (child) {
            if (child.feature) features.push(child.feature);
            if (child.georaster) raster = child.georaster;
        });
    }

    if (raster) {
        var metadata = [
            ['Tipo', 'GeoTIFF ráster'],
            ['Bandas', raster.numberOfRasters],
            ['Columnas', raster.width],
            ['Filas', raster.height],
            ['Resolución X', raster.pixelWidth],
            ['Resolución Y', raster.pixelHeight]
        ];
        (raster.mins || []).forEach(function (value, index) { metadata.push(['Mínimo banda ' + (index + 1), value]); });
        (raster.maxs || []).forEach(function (value, index) { metadata.push(['Máximo banda ' + (index + 1), value]); });
        var infoTable = document.createElement('table');
        infoTable.className = 'attribute-table';
        var infoHead = infoTable.createTHead().insertRow();
        appendAttributeCell(infoHead, 'Propiedad', 'th');
        appendAttributeCell(infoHead, 'Valor', 'th');
        var infoBody = infoTable.createTBody();
        metadata.forEach(function (item) {
            var row = infoBody.insertRow();
            appendAttributeCell(row, item[0]);
            appendAttributeCell(row, item[1]);
        });
        attributeTableWrap.appendChild(infoTable);
        return;
    }

    if (!features.length) {
        var emptyMessage = document.createElement('p');
        emptyMessage.className = 'attribute-empty';
        emptyMessage.textContent = 'Esta capa todavía no tiene registros cargados.';
        attributeTableWrap.appendChild(emptyMessage);
        return;
    }

    var fields = [];
    features.forEach(function (feature) {
        Object.keys(feature.properties || {}).forEach(function (field) {
            if (fields.indexOf(field) === -1) fields.push(field);
        });
    });
    var table = document.createElement('table');
    table.className = 'attribute-table';
    var headRow = table.createTHead().insertRow();
    appendAttributeCell(headRow, '#', 'th');
    fields.forEach(function (field) { appendAttributeCell(headRow, field, 'th'); });
    var body = table.createTBody();
    features.forEach(function (feature, index) {
        var row = body.insertRow();
        appendAttributeCell(row, index + 1);
        fields.forEach(function (field) { appendAttributeCell(row, (feature.properties || {})[field]); });
    });
    attributeTableWrap.appendChild(table);
}

function openAttributeDialog() {
    var selected = attributeLayerSelect.value;
    attributeLayerSelect.replaceChildren();
    Object.keys(capas).forEach(function (name) {
        var option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        attributeLayerSelect.appendChild(option);
    });
    if (selected && capas[selected]) attributeLayerSelect.value = selected;
    attributeDialog.hidden = false;
    renderAttributeTable(attributeLayerSelect.value);
}

attributeTableButton.addEventListener('click', openAttributeDialog);
attributeLayerSelect.addEventListener('change', function () { renderAttributeTable(attributeLayerSelect.value); });
attributeDialog.querySelector('.attribute-dialog-close').addEventListener('click', function () { attributeDialog.hidden = true; });
attributeDialog.addEventListener('click', function (event) {
    if (event.target === attributeDialog) attributeDialog.hidden = true;
});
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !attributeDialog.hidden) attributeDialog.hidden = true;
});

// ======================================================
// HERRAMIENTAS DE DIBUJO Y MEDICCIÃ“N
// ======================================================

var drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
        marker: {
            title: 'Crear punto',
            icon: new L.DivIcon({
                className: 'custom-marker',
                html: '<span></span>',
                iconSize: [16, 16]
            })
        },
        polygon: {
            title: 'Crear polÃ­gono',
            allowIntersection: false,
            showArea: true,
            metric: true,
            shapeOptions: {
                color: '#0f766e',
                weight: 2,
                opacity: 0.95,
                fillColor: '#5eead4',
                fillOpacity: 0.25
            }
        },
        polyline: {
            title: 'Crear linea y medir longitud',
            metric: true,
            shapeOptions: {
                color: '#f59e0b',
                weight: 4,
                opacity: 0.9
            }
        },
        circle: false,
        rectangle: false,
        circlemarker: false,
        edit: {
            featureGroup: capasDeUsuario,
            remove: true
        },
        delete: false
    }
}).addTo(map);

function calcularDistancia(latlngs) {
    var distancia = 0;

    for (var i = 1; i < latlngs.length; i++) {
        distancia += map.distance(latlngs[i - 1], latlngs[i]);
    }

    return distancia;
}

function calcularArea(latlngs) {
    if (!latlngs || latlngs.length < 3) {
        return 0;
    }

    if (L.GeometryUtil && L.GeometryUtil.geodesicArea) {
        return L.GeometryUtil.geodesicArea(latlngs);
    }
    var area = 0;
    var radio = 6378137;
    for (var i = 0; i < latlngs.length; i++) {
        var puntoActual = latlngs[i];
        var puntoSiguiente = latlngs[(i + 1) % latlngs.length];
        area += (puntoSiguiente.lng - puntoActual.lng) * Math.PI / 180 *
            (2 + Math.sin(puntoActual.lat * Math.PI / 180) + Math.sin(puntoSiguiente.lat * Math.PI / 180));
    }
    return Math.abs(area * radio * radio / 2);
}

function formatoLongitud(metros) {
    return metros >= 1000 ? (metros / 1000).toFixed(2) + ' km' : metros.toFixed(1) + ' m';
}

function formatoArea(metrosCuadrados) {
    return metrosCuadrados >= 1000000
        ? (metrosCuadrados / 1000000).toFixed(2) + ' kmÂ²'
        : metrosCuadrados.toFixed(0) + ' mÂ²';
}

function obtenerMedida(layer) {
    if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
        return { tipo: 'PolÃ­gono', texto: formatoArea(calcularArea(layer.getLatLngs()[0])) };
    }
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        return { tipo: 'LÃ­nea', texto: formatoLongitud(calcularDistancia(layer.getLatLngs())) };
    }
    return null;
}

var medicionesContraidas = localStorage.getItem('mediciones-contraidas') === 'true';
var panelMediciones = L.control({ position: 'topleft' });
panelMediciones.onAdd = function () {
    this._container = L.DomUtil.create('section', 'measurement-panel');
    this._container.setAttribute('aria-label', 'Mediciones creadas');
    L.DomEvent.disableClickPropagation(this._container);
    L.DomEvent.disableScrollPropagation(this._container);
    return this._container;
};
panelMediciones.addTo(map);

function actualizarPanelMediciones() {
    if (!panelMediciones._container) return;
    var elementos = [];
    capasDeUsuario.eachLayer(function (layer) {
        var medida = obtenerMedida(layer);
        if (medida) elementos.push({ layer: layer, medida: medida });
    });
    panelMediciones._container.classList.toggle('is-collapsed', medicionesContraidas);
    var html = '<div class="measurement-heading"><div><strong>Elementos creados</strong>' +
        '<small>' + elementos.length + ' geometrÃ­a' + (elementos.length === 1 ? '' : 's') + '</small></div>' +
        '<button type="button" class="toggle-measurements" aria-expanded="' + (!medicionesContraidas) + '" aria-label="' + (medicionesContraidas ? 'Mostrar mediciones' : 'Ocultar mediciones') + '" title="' + (medicionesContraidas ? 'Mostrar mediciones' : 'Ocultar mediciones') + '">' + (medicionesContraidas ? '+' : '-') + '</button>' +
        '<button type="button" class="clear-measurements" ' + (elementos.length ? '' : 'disabled') + '>Borrar todo</button></div>';
    var contenido = '';
    if (!elementos.length) {
        contenido = '<p class="measurement-empty">Dibuja una lÃ­nea o un polÃ­gono para ver aquÃ­ su longitud o Ã¡rea.</p>';
    } else {
        contenido = '<ul class="measurement-list">' + elementos.map(function (item, index) {
            return '<li><button type="button" class="measurement-focus" data-index="' + index + '">' +
                '<span>' + item.medida.tipo + ' ' + (index + 1) + '</span><strong>' + item.medida.texto + '</strong></button>' +
                '<button type="button" class="measurement-delete" data-index="' + index + '" aria-label="Borrar ' + item.medida.tipo + ' ' + (index + 1) + '" title="Borrar">Ã—</button></li>';
        }).join('') + '</ul>';
    }
    html += '<div class="measurement-content">' + contenido + '</div>';
    panelMediciones._container.innerHTML = html;
    panelMediciones._container.querySelector('.toggle-measurements').addEventListener('click', function () {
        medicionesContraidas = !medicionesContraidas;
        localStorage.setItem('mediciones-contraidas', String(medicionesContraidas));
        actualizarPanelMediciones();
    });
    panelMediciones._container.querySelector('.clear-measurements').addEventListener('click', function () {
        capasDeUsuario.clearLayers();
        actualizarPanelMediciones();
        setStatus('Se borraron las geometrÃ­as creadas.');
    });
    panelMediciones._container.querySelectorAll('.measurement-delete').forEach(function (button) {
        button.addEventListener('click', function () {
            capasDeUsuario.removeLayer(elementos[Number(button.dataset.index)].layer);
            actualizarPanelMediciones();
        });
    });
    panelMediciones._container.querySelectorAll('.measurement-focus').forEach(function (button) {
        button.addEventListener('click', function () {
            var layer = elementos[Number(button.dataset.index)].layer;
            map.fitBounds(layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng()]));
            if (layer.openPopup) layer.openPopup();
        });
    });
}

map.on(L.Draw.Event.CREATED, function (event) {
    var layer = event.layer;
    capasDeUsuario.addLayer(layer);

    if (layer instanceof L.Marker) {
        layer.bindPopup('Punto creado');
    }
    var medida = obtenerMedida(layer);
    if (medida) {
        layer.bindPopup('<strong>' + medida.tipo + '</strong><br>' +
            (medida.tipo === 'Poligono' ? 'Area: ' : 'Longitud: ') + medida.texto);
    }
    actualizarPanelMediciones();
});

map.on(L.Draw.Event.EDITED, function (event) {
    event.layers.eachLayer(function (layer) {
        var medida = obtenerMedida(layer);
        if (medida && layer.getPopup()) {
            layer.setPopupContent('<strong>' + medida.tipo + '</strong><br>' +
                (medida.tipo === 'Poligono' ? 'Area: ' : 'Longitud: ') + medida.texto);
        }
    });
    actualizarPanelMediciones();
    setStatus('Las geometrias fueron actualizadas.');
});

map.on(L.Draw.Event.DELETED, function () {
    actualizarPanelMediciones();
    setStatus('La geometria fue eliminada.');
});

capasDeUsuario.on('layerremove', actualizarPanelMediciones);
actualizarPanelMediciones();

function setStatus(mensaje) {
    var status = document.querySelector('.map-status-control');
    if (status) {
        status.textContent = mensaje;
        return;
    }

    status = L.DomUtil.create('div', 'map-status-control');
    status.textContent = mensaje;
    status.setAttribute('role', 'status');
    map.getContainer().appendChild(status);
}

setStatus('Herramientas activas: mediciÃ³n, puntos y polÃ­gonos.');


// ======================================================
// CONTROL DE COORDENADAS
// ======================================================

var coordsControl = L.control({
    position: 'bottomleft'
});


coordsControl.onAdd = function (map) {

    this._div = L.DomUtil.create(
        'div',
        'leaflet-bar coordenadas-control'
    );

    this._div.innerHTML =
        'Lat: -- | Lon: --';

    return this._div;
};


coordsControl.addTo(map);

// Acciones rÃ¡pidas del encabezado.
document.getElementById('coordinate-search').addEventListener('submit', function (event) {
    event.preventDefault();
    var partes = document.getElementById('coordinate-input').value
        .split(/[;,\s]+/).filter(Boolean).map(Number);
    if (partes.length !== 2 || !partes.every(Number.isFinite) ||
        Math.abs(partes[0]) > 90 || Math.abs(partes[1]) > 180) {
        setStatus('Escribe coordenadas vÃ¡lidas como: 6.24, -75.58');
        return;
    }
    map.setView([partes[0], partes[1]], 16);
    L.marker([partes[0], partes[1]]).addTo(capasDeUsuario)
        .bindPopup('UbicaciÃ³n buscada<br>' + partes[0].toFixed(6) + ', ' + partes[1].toFixed(6))
        .openPopup();
    setStatus('UbicaciÃ³n encontrada.');
});

document.getElementById('fullscreen-button').addEventListener('click', function () {
    var contenedor = document.documentElement;
    if (!document.fullscreenElement) {
        contenedor.requestFullscreen().catch(function () {
            setStatus('No se pudo activar pantalla completa.');
        });
    } else {
        document.exitFullscreen();
    }
});


// ======================================================
// ACTUALIZAR COORDENADAS AL MOVER EL CURSOR
// ======================================================

map.on('mousemove', function (e) {

    coordsControl._div.innerHTML =
        'Lat: ' +
        e.latlng.lat.toFixed(6) +
        ' | Lon: ' +
        e.latlng.lng.toFixed(6);

});
