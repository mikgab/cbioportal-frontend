import OncoprintJS, {RuleSetParams, TrackSortComparator} from "oncoprintjs";
import {
    ClinicalTrackSpec,
    GeneticTrackSpec,
    IGeneHeatmapTrackDatum,
    IGeneHeatmapTrackSpec,
    IGenesetHeatmapTrackDatum,
    IGenesetHeatmapTrackSpec
} from "./Oncoprint";
import {ClinicalAttribute} from "../../api/generated/CBioPortalAPI";
import {genetic_rule_set_same_color_for_all_no_recurrence,
    genetic_rule_set_same_color_for_all_recurrence,
    genetic_rule_set_different_colors_no_recurrence,
    genetic_rule_set_different_colors_recurrence} from "./geneticrules";
import {OncoprintPatientGeneticTrackData, OncoprintSampleGeneticTrackData} from "../../lib/QuerySession";
import {
    AnnotatedExtendedAlteration,
    AnnotatedMutation, CaseAggregatedData, ExtendedAlteration,
    ResultsViewPageStore
} from "../../../pages/resultsView/ResultsViewPageStore";
import {remoteData} from "../../api/remoteData";
import {
    makeClinicalTrackData,
    makeGeneticTrackData,
    makeHeatmapTrackData
} from "./DataUtils";
import ResultsViewOncoprint from "./ResultsViewOncoprint";
import _ from "lodash";
import {action} from "mobx";
import {SpecialAttribute} from "shared/cache/ClinicalDataCache";
import Spec = Mocha.reporters.Spec;
import {OQLLineFilterOutput} from "../../lib/oql/oqlfilter";

export function doWithRenderingSuppressedAndSortingOff(oncoprint:OncoprintJS<any>, task:()=>void) {
    oncoprint.suppressRendering();
    oncoprint.keepSorted(false);
    task();
    oncoprint.keepSorted(true);
    oncoprint.releaseRendering();
}

export function getHeatmapTrackRuleSetParams() {
    return {
        type: 'gradient' as 'gradient',
        legend_label: 'Expression Heatmap',
        value_key: 'profile_data',
        value_range: [-3,3] as [number, number],
        colors: [[0,0,255,1], [0,0,0,1], [255,0,0,1]],
        value_stop_points: [-3, 0, 3],
        null_color: 'rgba(224,224,224,1)'
    };
}

export function getGenesetHeatmapTrackRuleSetParams() {
    return {
        type: 'gradient' as 'gradient',
        legend_label: 'Gene Set Heatmap',
        value_key: 'profile_data',
        value_range: [-1,1] as [number, number],
        /*
         * The PiYG colormap is based on color specifications and designs
         * developed by Cynthia Brewer (http://colorbrewer.org).
         * The palette has been included under the terms
         * of an Apache-style license.
         */
        colors: [
            [ 39, 100,  25, 1],
            [ 77, 146,  33, 1],
            [127, 188,  65, 1],
            [184, 225, 134, 1],
            [230, 245, 208, 1],
            [247, 247, 247, 1],
            [253, 224, 239, 1],
            [241, 182, 218, 1],
            [222, 119, 174, 1],
            [197,  27, 125, 1],
            [142,   1,  82, 1]
        ],
        value_stop_points: [
            -1, -0.8, -0.6, -0.4, -0.2,
            0, 0.2, 0.4, 0.6, 0.8, 1
        ],
        null_color: 'rgba(224,224,224,1)'
    };
}

export function getGeneticTrackRuleSetParams(distinguishMutationType?:boolean, distinguishDrivers?:boolean):RuleSetParams {
    if (!distinguishMutationType && !distinguishDrivers) {
        return genetic_rule_set_same_color_for_all_no_recurrence;
    } else if (!distinguishMutationType && distinguishDrivers) {
        return genetic_rule_set_same_color_for_all_recurrence;
    } else if (distinguishMutationType && !distinguishDrivers) {
        return genetic_rule_set_different_colors_no_recurrence;
    } else {
        return genetic_rule_set_different_colors_recurrence;
    }
}

export function getClinicalTrackRuleSetParams(track:ClinicalTrackSpec) {
    if (track.datatype === "number") {
        return {
            type: 'bar',
            value_key: "attr_val",
            value_range: track.numberRange,
            log_scale: track.numberLogScale
        };
    } else if (track.datatype === "counts") {
        return {
            type: "stacked_bar",
            value_key: "attr_val",
            categories: track.countsCategoryLabels,
            fills: track.countsCategoryFills
        };
    } else {
        return {
            type: 'categorical',
            category_key: "attr_val"
        };
    }
}

export function percentAltered(altered:number, sequenced:number) {
    if (sequenced === 0) {
        return "N/S";
    }

    const p = altered/sequenced;
    const percent = 100*p;
    let fixed:string;
    if (p < 0.03) {
        // if less than 3%, use one decimal digit
        fixed = percent.toFixed(1);
        // if last digit is a 0, use no decimal digits
        if (fixed[fixed.length-1] === "0") {
            fixed = percent.toFixed();
        }
    } else {
        fixed = percent.toFixed();
    }
    return fixed+"%";
}

export function alterationInfoForCaseAggregatedDataByOQLLine(
    sampleMode: boolean,
    data: {
        cases:CaseAggregatedData<AnnotatedExtendedAlteration>,
        oql:OQLLineFilterOutput<AnnotatedExtendedAlteration>
    },
    sequencedSampleKeysByGene: {[hugoGeneSymbol:string]:string[]},
    sequencedPatientKeysByGene: {[hugoGeneSymbol:string]:string[]})
{
    const sequenced =
        sampleMode ?
            sequencedSampleKeysByGene[data.oql.gene].length :
            sequencedPatientKeysByGene[data.oql.gene].length;

    const altered =
        sampleMode ?
            Object.keys(data.cases.samples).filter(k=>!!data.cases.samples[k].length).length :
            Object.keys(data.cases.patients).filter(k=>!!data.cases.patients[k].length).length;

    return {
        sequenced,
        altered,
        percent: percentAltered(altered, sequenced)
    };
}

export function makeGeneticTracksMobxPromise(oncoprint:ResultsViewOncoprint, sampleMode:boolean) {
    return remoteData<GeneticTrackSpec[]>({
        await:()=>[
            oncoprint.props.store.genes,
            oncoprint.props.store.samples,
            oncoprint.props.store.patients,
            oncoprint.props.store.putativeDriverFilteredCaseAggregatedDataByOQLLine,
            oncoprint.props.store.molecularProfileIdToMolecularProfile,
            oncoprint.props.store.genePanelInformation,
            oncoprint.props.store.alteredSampleKeys,
            oncoprint.props.store.sequencedSampleKeysByGene,
            oncoprint.props.store.alteredPatientKeys,
            oncoprint.props.store.sequencedPatientKeysByGene
        ],
        invoke: async()=>{
            return oncoprint.props.store.putativeDriverFilteredCaseAggregatedDataByOQLLine.result!.map(
                (x:{cases:CaseAggregatedData<AnnotatedExtendedAlteration>, oql:OQLLineFilterOutput<AnnotatedExtendedAlteration>}, index:number)=>{
                const data = makeGeneticTrackData(
                    sampleMode ? x.cases.samples : x.cases.patients,
                    x.oql.gene,
                    sampleMode ? oncoprint.props.store.samples.result! : oncoprint.props.store.patients.result!,
                    oncoprint.props.store.genePanelInformation.result!
                );

                const info = alterationInfoForCaseAggregatedDataByOQLLine(sampleMode, x,
                    oncoprint.props.store.sequencedSampleKeysByGene.result!,
                    oncoprint.props.store.sequencedPatientKeysByGene.result!).percent;

                return {
                    key: `GENETICTRACK_${index}`,
                    label: x.oql.gene,
                    oql: x.oql.oql_line,
                    info,
                    data
                };
            });
        },
        default: [],
    });   
}

export function makeClinicalTracksMobxPromise(oncoprint:ResultsViewOncoprint, sampleMode:boolean) {
    return remoteData<ClinicalTrackSpec[]>({
        await:()=>[
            oncoprint.props.store.samples,
            oncoprint.props.store.patients,
            oncoprint.clinicalAttributesById
        ],
        invoke: async()=>{
            if (oncoprint.selectedClinicalAttributeIds.keys().length === 0) {
                return [];
            }
            const attributes = oncoprint.selectedClinicalAttributeIds.keys().map(attrId=>{
                return oncoprint.clinicalAttributesById.result![attrId];
            }).filter(x=>!!x);
            await oncoprint.props.store.clinicalDataCache.getPromise(attributes, true);
            return attributes.map((attribute:ClinicalAttribute)=>{
                const data = oncoprint.props.store.clinicalDataCache.get(attribute)!.data!;
                const ret:Partial<ClinicalTrackSpec> = {
                    key: oncoprint.clinicalAttributeIdToTrackKey(attribute.clinicalAttributeId),
                    label: attribute.displayName,
                    description: attribute.description,
                    data:makeClinicalTrackData(
                        attribute,
                        sampleMode ? oncoprint.props.store.samples.result! : oncoprint.props.store.patients.result!,
                        data
                    ),
                };
                if (attribute.datatype === "NUMBER") {
                    ret.datatype = "number";
                    if (attribute.clinicalAttributeId === SpecialAttribute.FractionGenomeAltered) {
                        (ret as any).numberRange = [0,1];
                    } else if (attribute.clinicalAttributeId === SpecialAttribute.MutationCount) {
                        (ret as any).numberLogScale = true;
                    }
                } else if (attribute.datatype === "STRING") {
                    ret.datatype = "string";
                } else if (attribute.clinicalAttributeId === SpecialAttribute.MutationSpectrum) {
                    ret.datatype = "counts";
                    (ret as any).countsCategoryLabels = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
                    (ret as any).countsCategoryFills = ['#3D6EB1', '#8EBFDC', '#DFF1F8', '#FCE08E', '#F78F5E', '#D62B23'];
                }
                return ret as ClinicalTrackSpec;
            });
        },
        default: []
    });
}

export function makeHeatmapTracksMobxPromise(oncoprint:ResultsViewOncoprint, sampleMode:boolean) {
    return remoteData<IGeneHeatmapTrackSpec[]>({
        await:()=>[
            oncoprint.props.store.samples,
            oncoprint.props.store.patients,
            oncoprint.props.store.molecularProfileIdToMolecularProfile,
            oncoprint.props.store.geneMolecularDataCache
        ],
        invoke:async()=>{
            const molecularProfileIdToMolecularProfile = oncoprint.props.store.molecularProfileIdToMolecularProfile.result!;
            const molecularProfileIdToHeatmapTracks = oncoprint.molecularProfileIdToHeatmapTracks;

            const neededGenes = _.flatten(molecularProfileIdToHeatmapTracks.values().map(v=>v.genes.keys()));
            const genes = await oncoprint.props.store.geneCache.getPromise(neededGenes.map(g=>({hugoGeneSymbol:g})), true);

            const cacheQueries = _.flatten(molecularProfileIdToHeatmapTracks.entries().map(entry=>(
                entry[1].genes.keys().map(g=>({
                    molecularProfileId: entry[0],
                    entrezGeneId: oncoprint.props.store.geneCache.get({ hugoGeneSymbol:g })!.data!.entrezGeneId,
                    hugoGeneSymbol: g.toUpperCase()
                }))
            )));
            await oncoprint.props.store.geneMolecularDataCache.result!.getPromise(cacheQueries, true);

            const samples = oncoprint.props.store.samples.result!;
            const patients = oncoprint.props.store.patients.result!;

            return cacheQueries.map(query=>{
                const molecularProfileId = query.molecularProfileId;
                const gene = query.hugoGeneSymbol;
                const data = oncoprint.props.store.geneMolecularDataCache.result!.get(query)!.data!;
                return {
                    key: `HEATMAPTRACK_${molecularProfileId},${gene}`,
                    label: gene,
                    molecularProfileId: molecularProfileId,
                    molecularAlterationType: molecularProfileIdToMolecularProfile[molecularProfileId].molecularAlterationType,
                    datatype: molecularProfileIdToMolecularProfile[molecularProfileId].datatype,
                    data: makeHeatmapTrackData<IGeneHeatmapTrackDatum, 'hugo_gene_symbol'>(
                        'hugo_gene_symbol',
                        gene,
                        sampleMode ? samples : patients,
                        data
                    ),
                    trackGroupIndex: molecularProfileIdToHeatmapTracks.get(molecularProfileId)!.trackGroupIndex,
                    onRemove:action(()=>{
                        const trackGroup = molecularProfileIdToHeatmapTracks.get(molecularProfileId);
                        if (trackGroup) {
                            trackGroup.genes.delete(gene);
                            if (!trackGroup.genes.size) {
                                molecularProfileIdToHeatmapTracks.delete(molecularProfileId);
                            }
                        }
                        if (!molecularProfileIdToHeatmapTracks.has(molecularProfileId)
                            && oncoprint.sortMode.type === "heatmap"
                            && oncoprint.sortMode.clusteredHeatmapProfile === molecularProfileId
                        ) {
                            oncoprint.sortByData();
                        }
                    })
                };
            });
        },
        default: []
    });
}

export function makeGenesetHeatmapTracksMobxPromise(
    oncoprint:ResultsViewOncoprint, sampleMode:boolean
) {
    return remoteData<IGenesetHeatmapTrackSpec[]>({
        await: () => [
            oncoprint.props.store.samples,
            oncoprint.props.store.patients,
            oncoprint.props.store.genesetMolecularProfile,
            oncoprint.props.store.genesetMolecularDataCache,
            oncoprint.props.store.genesetLinkMap
        ],
        invoke: async () => {
            const samples = oncoprint.props.store.samples.result!;
            const patients = oncoprint.props.store.patients.result!;
            const molecularProfile = oncoprint.props.store.genesetMolecularProfile.result!;
            const dataCache = oncoprint.props.store.genesetMolecularDataCache.result!;
            const genesetLinkMap = oncoprint.props.store.genesetLinkMap.result!;

            // observe computed property based on other tracks
            const trackGroup = oncoprint.genesetHeatmapTrackGroup;

            if (!molecularProfile.isApplicable) {
                return [];
            }
            const molecularProfileId = molecularProfile.value.molecularProfileId;
            const genesetIds = oncoprint.props.store.genesetIds;

            const cacheQueries = genesetIds.map((genesetId) => ({molecularProfileId, genesetId}));
            await dataCache.getPromise(cacheQueries, true);

            return genesetIds.map((genesetId) => ({
                key: `GENESETHEATMAPTRACK_${molecularProfileId},${genesetId},GROUP${trackGroup}`,
                label: genesetId,
                molecularProfileId,
                molecularAlterationType: molecularProfile.value.molecularAlterationType,
                datatype: molecularProfile.value.datatype,
                trackLinkUrl: genesetLinkMap[genesetId],
                data: makeHeatmapTrackData<IGenesetHeatmapTrackDatum, 'geneset_id'>(
                    'geneset_id',
                    genesetId,
                    sampleMode ? samples : patients,
                    dataCache.get({molecularProfileId, genesetId})!.data!
                ),
                trackGroupIndex: trackGroup
            }));
        },
        default: []
    });
}
