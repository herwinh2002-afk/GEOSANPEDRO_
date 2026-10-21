// ======================================================
// CONFIGURACIÓN DEL MAPA
// ======================================================

var map = L.map('map', {
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
    maxZoom: 20,
    minZoom: 2
}).setView([6.24, -75.58], 13);

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
// FUNCIÓN PARA MOSTRAR LOS ATRIBUTOS DEL SHAPEFILE
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

    if (opciones.visible !== false) {
        grupo.addTo(map);
    }

    return grupo;
}


// ======================================================
// CARGA DE CAPAS VECTORIALES DE LA CARPETA date
// ======================================================

// Coloca aquí los nombres de tus archivos ZIP.
//
// Ejemplo:
//
// var expansion = cargarShapefile(
//     'data/AREA_EXPANSION_ROBLEDO_43262.zip',
//     'Área de expansión'
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
        style: {
            color: '#dc2626',
            weight: 2,
            opacity: 0.9,
            fillOpacity: 0.18
        }
    }
);


// ======================================================
// FUNCIÓN PARA CARGAR GEOTIFF
// ======================================================

var limitesRasters = L.latLngBounds();


function cargarGeoTiff(ruta, nombre, opciones) {

    opciones = opciones || {};

    if (window.location.protocol === 'file:') {
        console.warn('El raster "' + nombre + '" no se puede cargar desde archivo local. Sirve la carpeta con un servidor HTTP (por ejemplo: python -m http.server 8000) y vuelve a abrir la página.');
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
            // no valores RGBA de 0 a 65535. Normalizar contra sus estadísticas
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

            if (opciones.visible !== false) {
                grupo.addTo(map);
            }
        })

        .catch(function (error) {
            console.error('No se pudo cargar ' + ruta + ':', error);
            setStatus('No se pudo cargar el raster ' + nombre + '. Revisa que la app esté en un servidor local y que el archivo exista.');
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
        visible: true,
        // Clasificación hipsométrica: verde (bajo), amarillo/ocre (medio),
        // marrón (alto). Los cortes se basan en el rango 0–3029 m del DEM.
        cortes: [0, 500, 1000, 1500, 2000, 2500, 3000],
        rampa: ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fdae61', '#d66b36', '#7f3b08']
    }
);

// Leyenda para las clases codificadas del raster de pendientes.
var leyendaPendientes = L.control({ position: 'bottomright' });
leyendaPendientes.onAdd = function () {
    var div = L.DomUtil.create('div', 'status-control');
    div.innerHTML = '<strong>Pendientes IGAC</strong>' +
        '<div><span style="color:#1a9850">■</span> Clase 1</div>' +
        '<div><span style="color:#91cf60">■</span> Clase 2</div>' +
        '<div><span style="color:#d9ef8b">■</span> Clase 3</div>' +
        '<div><span style="color:#fee08b">■</span> Clase 4</div>' +
        '<div><span style="color:#fc8d59">■</span> Clase 5</div>' +
        '<div><span style="color:#d73027">■</span> Clase 6</div>' +
        '<div><span style="color:#762a83">■</span> Clase 7</div>';
    return div;
};
leyendaPendientes.addTo(map);

cargarGeoTiff(
    'date/Pendientes_Clase_IGAC_San_pedro.tif',
    'Pendientes IGAC',
    {
        opacity: 0.8,
        visible: true,
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


// ======================================================
// HERRAMIENTAS DE DIBUJO Y MEDICCIÓN
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
            title: 'Crear polígono',
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
        ? (metrosCuadrados / 1000000).toFixed(2) + ' km²'
        : metrosCuadrados.toFixed(0) + ' m²';
}

function obtenerMedida(layer) {
    if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
        return { tipo: 'Polígono', texto: formatoArea(calcularArea(layer.getLatLngs()[0])) };
    }
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        return { tipo: 'Línea', texto: formatoLongitud(calcularDistancia(layer.getLatLngs())) };
    }
    return null;
}

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
    var html = '<div class="measurement-heading"><div><strong>Mediciones</strong>' +
        '<small>' + elementos.length + ' geometría' + (elementos.length === 1 ? '' : 's') + '</small></div>' +
        '<button type="button" class="clear-measurements" ' + (elementos.length ? '' : 'disabled') + '>Borrar todo</button></div>';
    if (!elementos.length) {
        html += '<p class="measurement-empty">Dibuja una línea o un polígono para ver aquí su longitud o área.</p>';
    } else {
        html += '<ul class="measurement-list">' + elementos.map(function (item, index) {
            return '<li><button type="button" class="measurement-focus" data-index="' + index + '">' +
                '<span>' + item.medida.tipo + ' ' + (index + 1) + '</span><strong>' + item.medida.texto + '</strong></button>' +
                '<button type="button" class="measurement-delete" data-index="' + index + '" aria-label="Borrar ' + item.medida.tipo + ' ' + (index + 1) + '" title="Borrar">×</button></li>';
        }).join('') + '</ul>';
    }
    panelMediciones._container.innerHTML = html;
    panelMediciones._container.querySelector('.clear-measurements').addEventListener('click', function () {
        capasDeUsuario.clearLayers();
        actualizarPanelMediciones();
        setStatus('Se borraron las geometrías creadas.');
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

setStatus('Herramientas activas: medición, puntos y polígonos.');


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

// Acciones rápidas del encabezado.
document.getElementById('coordinate-search').addEventListener('submit', function (event) {
    event.preventDefault();
    var partes = document.getElementById('coordinate-input').value
        .split(/[;,\s]+/).filter(Boolean).map(Number);
    if (partes.length !== 2 || !partes.every(Number.isFinite) ||
        Math.abs(partes[0]) > 90 || Math.abs(partes[1]) > 180) {
        setStatus('Escribe coordenadas válidas como: 6.24, -75.58');
        return;
    }
    map.setView([partes[0], partes[1]], 16);
    L.marker([partes[0], partes[1]]).addTo(capasDeUsuario)
        .bindPopup('Ubicación buscada<br>' + partes[0].toFixed(6) + ', ' + partes[1].toFixed(6))
        .openPopup();
    setStatus('Ubicación encontrada.');
});

document.getElementById('home-button').addEventListener('click', function () {
    map.fitBounds(mapBounds, { padding: [24, 24] });
});

document.getElementById('locate-button').addEventListener('click', function () {
    if (!navigator.geolocation) {
        setStatus('Este navegador no permite obtener la ubicación.');
        return;
    }
    setStatus('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(function (position) {
        var point = [position.coords.latitude, position.coords.longitude];
        map.setView(point, 16);
        L.circleMarker(point, {
            radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1
        }).addTo(capasDeUsuario).bindPopup('Estás aquí').openPopup();
        setStatus('Ubicación actual encontrada.');
    }, function () {
        setStatus('No se pudo obtener la ubicación. Revisa los permisos del navegador.');
    }, { enableHighAccuracy: true, timeout: 10000 });
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
