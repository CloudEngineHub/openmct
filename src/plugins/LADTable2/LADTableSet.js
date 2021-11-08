import EventEmitter from 'EventEmitter';
import LADTable from './LADTable';

export default class LADTableSet extends EventEmitter {
    // 1. change the structure of telemetryObjects to {tablekey: {teleKey: teleObj}}
    // 2. when add lad table. add an event ladtable.on('object-removed', this.removeTelemetryObj);
    constructor(domainObject, openmct) {
        super();
        this.domainObject = domainObject;
        this.openmct = openmct;
        this.updateFilters = this.updateFilters.bind(this);
        this.tables = {};
        this.telemetryObjects = {};
        // this.headers = {};

        this.composition = this.openmct.composition.get(this.domainObject);
        //where do i remove events below?
        this.composition.on('add', this.addLADTable.bind(this));
        this.composition.on('remove', this.removeLADTable.bind(this));
    }
    initialize() {
        if (this.domainObject.type === 'LadTableSet') {
            this.filterObserver = this.openmct.objects.observe(this.domainObject, 'configuration.filters', this.updateFilters);
            this.filters = this.domainObject.configuration.filters;
            this.loadComposition();
        } else {
            this.addLADTable(this.domainObject);
        }
    }
    loadComposition() {
        this.tableSetComposition = this.openmct.composition.get(this.domainObject);

        if (this.tableSetComposition !== undefined) {
            this.tableSetComposition.load().then((composition) => {
                composition.forEach(this.addLADTable.bind(this));
            });
        }
    }
    updateFilters(updatedFilters) {
        let deepCopiedFilters = JSON.parse(JSON.stringify(updatedFilters));

        if (this.filters && !_.isEqual(this.filters, deepCopiedFilters)) {
            this.filters = deepCopiedFilters;
            this.tableRows.clear();
            this.clearAndResubscribe();
        } else {
            this.filters = deepCopiedFilters;
        }
    }
    addLADTable(domainObject) {
        let key = domainObject.identifier.key;
        this.tables[key] = new LADTable(domainObject, this.openmct);

        this.tables[key].once('loaded', () => {
            // this.addHeaders(this.tables[key]);
            this.addTelemetryObjects(this.tables[key]);
        });
        this.tables[key].initialize();
        this.emit('table-added', this.tables[key]);
    }
    removeLADTable(identifier) {
        let key = identifier.key;
        delete this.tables[key];
        this.emit('table-removed', identifier);
    }
    addTelemetryObjects(ladTable) {
        let telemetryObjects = ladTable.telemetryObjects;
        for (let key in telemetryObjects) {
            if (telemetryObjects[key]) {
                let telemetryObject = {};
                telemetryObject.key = this.openmct.objects.makeKeyString(telemetryObjects[key].telemetryObject.identifier);
                telemetryObject.domainObject = telemetryObjects[key].telemetryObject;
                telemetryObject.metadata = this.openmct.telemetry.getMetadata(telemetryObjects[key].telemetryObject);
                telemetryObject.formats = this.openmct.telemetry.getFormatMap(telemetryObject.metadata);
                telemetryObject.limitEvaluator = this.openmct
                    .telemetry
                    .limitEvaluator(telemetryObject.domainObject);
                telemetryObject.valueMetadata = telemetryObject
                    .metadata
                    .valuesForHints(['range'])[0];
                telemetryObject.valueKey = telemetryObject.valueMetadata.key;
                if (!this.telemetryObjects[ladTable.keyString]) {
                    this.telemetryObjects[ladTable.keyString] = {};
                }

                this.telemetryObjects[ladTable.keyString][telemetryObject.key] = telemetryObject;
                this.emit('telemetry-object-added');
            }
        }
    }
    addHeaders(ladTable) {
        let headers = ladTable.headers;
        Object.assign(this.headers, headers);
        this.emit('headers-added');
    }
}