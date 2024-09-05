import { EventEmitter } from 'eventemitter3';

export default class CompsManager extends EventEmitter {
  #openmct;
  #domainObject;
  #composition;
  #telemetryObjects = {};
  #telemetryCollections = {};
  #dataFrame = {};
  #telemetryLoadedPromises = [];
  #loaded = false;
  #compositionLoaded = false;
  #telemetryProcessors = {};
  // make id random 4 digit number
  #id = Math.floor(Math.random() * 9000) + 1000;

  constructor(openmct, domainObject) {
    super();
    this.#openmct = openmct;
    this.#domainObject = domainObject;
    this.clearData = this.clearData.bind(this);
  }

  #getNextAlphabeticalParameterName() {
    const parameters = this.#domainObject.configuration.comps.parameters;
    const existingNames = new Set(parameters.map((p) => p.name));
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let suffix = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      for (let letter of alphabet) {
        const proposedName = letter + suffix;
        if (!existingNames.has(proposedName)) {
          return proposedName;
        }
      }
      // Increment suffix after exhausting the alphabet
      suffix = (parseInt(suffix, 10) || 0) + 1;
    }
  }

  addParameter(telemetryObject) {
    const keyString = this.#openmct.objects.makeKeyString(telemetryObject.identifier);
    const metaData = this.#openmct.telemetry.getMetadata(telemetryObject);
    const specificTelemetryCollection = this.#telemetryCollections[keyString];
    const specificTimeKey = specificTelemetryCollection.timeKey;
    const timeMetaData = metaData.valueMetadatas.find((metaDatum) => {
      return metaDatum.key === specificTimeKey || metaDatum.source === specificTimeKey;
    });
    // in the valuesMetadata, find the first numeric data type
    const rangeItems = metaData.valueMetadatas.filter(
      (metaDatum) => metaDatum.hints && metaDatum.hints.range
    );
    rangeItems.sort((a, b) => a.hints.range - b.hints.range);
    let valueToUse = rangeItems[0]?.key;
    if (!valueToUse) {
      // if no numeric data type, just use the first one
      valueToUse = metaData.valueMetadatas[0]?.key;
    }
    this.#domainObject.configuration.comps.parameters.push({
      keyString,
      name: `${this.#getNextAlphabeticalParameterName()}`,
      valueToUse,
      testValue: 0,
      timeMetaData
    });
    this.emit('parameterAdded', this.#domainObject);
  }

  getParameters() {
    const parameters = this.#domainObject.configuration.comps.parameters;
    const parametersWithTimeKey = parameters.map((parameter) => {
      return {
        ...parameter,
        timeKey: this.#telemetryCollections[parameter.keyString]?.timeKey
      };
    });
    return parametersWithTimeKey;
  }

  getTelemetryObjectForParameter(keyString) {
    return this.#telemetryObjects[keyString];
  }

  getMetaDataValuesForParameter(keyString) {
    const telemetryObject = this.getTelemetryObjectForParameter(keyString);
    const metaData = this.#openmct.telemetry.getMetadata(telemetryObject);
    return metaData.valueMetadatas;
  }

  deleteParameter(keyString) {
    this.#domainObject.configuration.comps.parameters =
      this.#domainObject.configuration.comps.parameters.filter(
        (parameter) => parameter.keyString !== keyString
      );
    // if there are no parameters referencing this parameter keyString, remove the telemetry object too
    const parameterExists = this.#domainObject.configuration.comps.parameters.some(
      (parameter) => parameter.keyString === keyString
    );
    if (!parameterExists) {
      this.emit('parameterRemoved', this.#domainObject);
    }
  }

  setDomainObject(passedDomainObject) {
    this.#domainObject = passedDomainObject;
  }

  isReady() {
    return this.#loaded;
  }

  async load() {
    if (!this.#compositionLoaded) {
      await this.#loadComposition();
      this.#compositionLoaded = true;
    }
    if (!this.#loaded) {
      await Promise.all(this.#telemetryLoadedPromises);
      this.#telemetryLoadedPromises = [];
      this.#loaded = true;
      console.debug('📦 CompsManager: loaded');
    }
  }

  async startListeningToUnderlyingTelemetry() {
    console.debug('🎉 CompsManager: startListeningToUnderlyingTelemetry');
    this.#loaded = false;
    Object.keys(this.#telemetryCollections).forEach((keyString) => {
      if (!this.#telemetryCollections[keyString].loaded) {
        this.#telemetryCollections[keyString].on('add', this.#getTelemetryProcessor(keyString));
        this.#telemetryCollections[keyString].on('clear', this.clearData);
        const telemetryLoadedPromise = this.#telemetryCollections[keyString].load();
        this.#telemetryLoadedPromises.push(telemetryLoadedPromise);
      }
    });
    await Promise.all(this.#telemetryLoadedPromises);
    this.#telemetryLoadedPromises = [];
    this.#loaded = true;
  }

  stopListeningToUnderlyingTelemetry() {
    console.debug('🔇 CompsManager: stopListeningToUnderlyingTelemetry');
    this.#loaded = false;
    Object.keys(this.#telemetryCollections).forEach((keyString) => {
      const specificTelemetryProcessor = this.#telemetryProcessors[keyString];
      delete this.#telemetryProcessors[keyString];
      this.#telemetryCollections[keyString].off('add', specificTelemetryProcessor);
      this.#telemetryCollections[keyString].off('clear', this.clearData);
      this.#telemetryCollections[keyString].destroy();
    });
  }

  getTelemetryObjects() {
    return this.#telemetryObjects;
  }

  async #loadComposition() {
    this.#composition = this.#openmct.composition.get(this.#domainObject);
    if (this.#composition) {
      this.#composition.on('add', this.#addTelemetryObject);
      this.#composition.on('remove', this.#removeTelemetryObject);
      await this.#composition.load();
    }
    console.debug(`📢 CompsManager: composition loaded`);
  }

  getFullDataFrame(newTelemetry) {
    const dataFrame = {};
    // can assume on data item
    const newTelemetryKey = Object.keys(newTelemetry)[0];
    const newTelemetryData = newTelemetry[newTelemetryKey];
    const otherTelemetryKeys = Object.keys(this.#telemetryCollections).filter(
      (keyString) => keyString !== newTelemetryKey
    );
    // initialize the data frame with the new telemetry data
    dataFrame[newTelemetryKey] = newTelemetryData;
    // initialize the other telemetry data
    otherTelemetryKeys.forEach((keyString) => {
      dataFrame[keyString] = [];
    });

    // march through the new telemetry data and add data to the frame from the other telemetry objects
    // using LOCF

    newTelemetryData.forEach((newDatum) => {
      otherTelemetryKeys.forEach((otherKeyString) => {
        const otherCollection = this.#telemetryCollections[otherKeyString];
        let insertionPointForNewData = otherCollection._sortedIndex(newDatum);
        const otherCollectionData = otherCollection.getAll();
        if (insertionPointForNewData && insertionPointForNewData >= otherCollectionData.length) {
          insertionPointForNewData = otherCollectionData.length - 1;
        }
        // get the closest datum to the new datum
        const closestDatum = otherCollectionData[insertionPointForNewData];
        if (closestDatum) {
          dataFrame[otherKeyString].push(closestDatum);
        }
      });
    });
    return dataFrame;
  }

  #removeTelemetryObject = (telemetryObjectIdentifier) => {
    console.debug('❌ CompsManager: removeTelemetryObject', telemetryObjectIdentifier);
    const keyString = this.#openmct.objects.makeKeyString(telemetryObjectIdentifier);
    delete this.#telemetryObjects[keyString];
    this.#telemetryCollections[keyString]?.destroy();
    delete this.#telemetryCollections[keyString];
    // remove all parameters that reference this telemetry object
    this.deleteParameter(keyString);
  };

  requestUnderlyingTelemetry() {
    const underlyingTelemetry = {};
    Object.keys(this.#telemetryCollections).forEach((collectionKey) => {
      const collection = this.#telemetryCollections[collectionKey];
      underlyingTelemetry[collectionKey] = collection.getAll();
    });
    return underlyingTelemetry;
  }

  #getTelemetryProcessor(keyString) {
    if (this.#telemetryProcessors[keyString]) {
      return this.#telemetryProcessors[keyString];
    }

    const telemetryProcessor = (newTelemetry) => {
      this.emit('underlyingTelemetryUpdated', { [keyString]: newTelemetry });
    };
    this.#telemetryProcessors[keyString] = telemetryProcessor;
    return telemetryProcessor;
  }

  #telemetryProcessor = (newTelemetry, keyString) => {
    this.emit('underlyingTelemetryUpdated', { [keyString]: newTelemetry });
  };

  clearData(telemetryLoadedPromise) {
    console.debug('💨 Clear Data fired, need to wait for all telemetry collections to load');
    this.#loaded = false;
    this.#telemetryLoadedPromises.push(telemetryLoadedPromise);
  }

  getOutputFormat() {
    return this.#domainObject.configuration.comps.outputFormat;
  }

  getExpression() {
    return this.#domainObject.configuration.comps.expression;
  }

  #addTelemetryObject = (telemetryObject) => {
    console.debug(`📢 CompsManager: addTelemetryObject`, telemetryObject);
    const keyString = this.#openmct.objects.makeKeyString(telemetryObject.identifier);
    this.#telemetryObjects[keyString] = telemetryObject;
    this.#telemetryCollections[keyString] =
      this.#openmct.telemetry.requestCollection(telemetryObject);

    this.#telemetryCollections[keyString].on('add', this.#getTelemetryProcessor(keyString));
    this.#telemetryCollections[keyString].on('clear', this.clearData);
    const telemetryLoadedPromise = this.#telemetryCollections[keyString].load();
    this.#telemetryLoadedPromises.push(telemetryLoadedPromise);
    console.debug('📢 CompsManager: loaded telemetry collection', keyString);

    // check to see if we have a corresponding parameter
    // if not, add one
    const parameterExists = this.#domainObject.configuration.comps.parameters.some(
      (parameter) => parameter.keyString === keyString
    );
    if (!parameterExists) {
      this.addParameter(telemetryObject);
    }
    console.debug(`📢 CompsManager: done adding telemetry object`, telemetryObject);
  };

  static getCompsManager(domainObject, openmct, compsManagerPool) {
    const id = openmct.objects.makeKeyString(domainObject.identifier);

    if (!compsManagerPool[id]) {
      compsManagerPool[id] = new CompsManager(openmct, domainObject);
    }

    return compsManagerPool[id];
  }
}
