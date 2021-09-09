/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2021, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

import { SPECTRAL_AGGREGATE_KEY } from './SpectralAggregateConstants';
export default function SpectralAggregatePlotCompositionPolicy(openmct) {
    function hasAggregateDomainAndRange(metadata) {
        const rangeValues = metadata.valuesForHints(['spectralAttribute']);
        const domainValues = metadata.valuesForHints(['spectralAttribute']);

        return rangeValues.length > 0
        || domainValues.length > 0;
    }

    function hasSpectralAggregateTelemetry(domainObject) {
        if (!Object.prototype.hasOwnProperty.call(domainObject, 'telemetry')) {
            return false;
        }

        let metadata = openmct.telemetry.getMetadata(domainObject);

        return metadata.values().length > 0 && hasAggregateDomainAndRange(metadata);
    }

    return {
        allow: function (parent, child) {
            if ((parent.type === SPECTRAL_AGGREGATE_KEY)
                && ((child.type !== 'telemetry.plot.overlay') && (hasSpectralAggregateTelemetry(child) === false))
            ) {
                return false;
            }

            return true;
        }
    };
}
