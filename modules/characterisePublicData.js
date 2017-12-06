


function coverageByClade() {
	var coveragePct = 90;
	var features = ["precursor_polyprotein", "Core", "E1", "E2", "p7", "NS2", "NS3", "NS4A", "NS4B", "NS5A", "NS5B"]

	var alignments;
	glue.inMode("alignment/AL_MASTER", function() {
		descResult = glue.command(["list", "descendent"]);
		alignments = tableResultGetColumn(descResult, "name");
	});
	
	var cladeObjList = [];

	_.each(alignments, function(almtName) {
		var displayName;
		var numMembers;
		glue.inMode("alignment/"+almtName, function() {
			displayName = glue.command("show property displayName").propertyValueResult.value;
			var result = glue.command(
					{"count":{"member":{"recursive":"true",
						"whereClause":
							"sequence.source.name = 'ncbi-curated' and "+
							"referenceMember = false"}}});
			numMembers = result.countResult.count;
		});
/*		if(displayName.indexOf("Subtype") >= 0 && numMembers < 500) {
			return;
		} */
		var cladeObj = { "Clade": displayName };
		cladeObj["Members"] = numMembers;
		_.each(features, function(featureName) {
			glue.inMode("alignment/"+almtName, function() {
				var result = glue.command(
						{"count":{"member":{"recursive":"true",
							"whereClause":
								"sequence.source.name = 'ncbi-curated' and "+
								"referenceMember = false and "+
								"fLocNotes.featureLoc.referenceSequence.name = 'REF_MASTER_NC_004102' and "+
								"fLocNotes.featureLoc.feature.name = '"+featureName+"' and "+
								"fLocNotes.ref_nt_coverage_pct >= "+coveragePct}}});
				cladeObj[featureName] = result.countResult.count;
			});
		});
		cladeObjList.push(cladeObj);
	});
	return cladeObjList;
}

