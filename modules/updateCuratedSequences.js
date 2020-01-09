function syncCurated() {
	glue.log("INFO", "Synchronizing source "+source.name+" with NCBI...");
	var syncResults;
	glue.inMode("module/"+modules.ncbiImporter, function() {
		syncResults = glue.command(["sync", "--detailed"], {convertTableToObjects:true});
		glue.log("FINEST", "NCBI syncronization report", syncResults);
		glue.log("INFO", "Synchronization complete");
	});
	glue.log("INFO", "Deleting surplus sequence files");
	var deleted = 0;
	_.each(syncResults, function(syncResult) {
		if(syncResult.status == "SURPLUS") {
			glue.command(["file-util", "delete-file", "sources/ncbi-curated/"+syncResult.sequenceID+".xml"]);
			deleted++;
		}
	});
	glue.log("INFO", "Deleted "+deleted+" surplus sequence files");
	glue.log("INFO", "Exporting incoming sequences to file system...");
	glue.command(["export", "source", "--whereClause", "ncbi_incoming = null", "--parentDir", source.path, source.name]);
}

function placeCuratedAll() {
	glue.log("INFO", "Deleting files in placement path "+placement.path);
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	_.each(placementPathFiles, function(placementPathFile) {
		if(placementPathFile.indexOf("xml") >= 0) {
			glue.command(["file-util", "delete-file", placement.path+"/"+placementPathFile.fileName]);
		}
	});
	glue.log("INFO", "Deleted "+placementPathFiles.length+" files");
	var fileSuffix = 1;
	var whereClause = "source.name = 'ncbi-curated'";
	placeCurated(whereClause, fileSuffix);
}

function pad(num, size) {
    var s = num+"";
    while (s.length < size) {
    	s = "0" + s;
    }
    return s;
}

function placeCuratedIncoming() {
	var placementPathFiles = glue.command(["file-util", "list-files", "--directory", placement.path], {convertTableToObjects:true});
	var placementFileNames = _.map(placementPathFiles, function(placementPathFile) {return placementPathFile.fileName;});
	var fileSuffix = 1;
	while(true) {
		fileSuffixString = pad(fileSuffix, 6);
		if(_.contains(placementFileNames, placement.prefix + fileSuffixString + ".xml")) {
			fileSuffix++;
		} else {
			break;
		}
	}
	var whereClause = "source.name = 'ncbi-curated' and ncbi_incoming = true";
	placeCurated(whereClause, fileSuffix);
}

function placeCurated(whereClause, fileSuffix) {
	glue.log("INFO", "Counting sequences where "+whereClause);
	var numSequences = glue.command(["count", "sequence", "--whereClause", whereClause]).countResult.count;
	glue.log("INFO", "Found "+numSequences+" sequences where "+whereClause);
	var batchSize = 50;
	var offset = 0;
	while(offset < numSequences) {
		glue.log("INFO", "Placing sequences starting at offset "+offset);
		glue.inMode("module/"+modules.placer, function() {
			fileSuffixString = pad(fileSuffix, 6);
			var outputFile = placement.path + "/" + placement.prefix + fileSuffixString + ".xml";
			glue.command(["place", "sequence", 
                           "--whereClause", whereClause,
                           "--pageSize", batchSize, "--fetchLimit", batchSize, "--fetchOffset", offset, 
                           "--outputFile", outputFile]);
		});
		offset += batchSize;
		fileSuffix++;
	}
}


function genotypeCurated() {
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	_.each(placementPathFiles, function(placementPathFile) {
		if(placementPathFile.fileName.indexOf("xml") >= 0) {
			glue.log("INFO", "Computing genotype results for placement file "+placementPathFile.fileName);
			var batchGenotyperResults;
			glue.inMode("module/"+modules.genotyper, function() {
				batchGenotyperResults = glue.command(
						["genotype", "placer-result", 
						 "--fileName", placement.path+"/"+placementPathFile.fileName, 
						 "--detailLevel", "HIGH"], 
						{convertTableToObjects:true});
			});
			glue.log("INFO", "Assigning genotype metadata for "+batchGenotyperResults.length+" genotyping results from placement file "+placementPathFile.fileName);
			var batchSize = 500;
			var numUpdates = 0;
			_.each(batchGenotyperResults, function(genotyperResult) {
				glue.inMode("sequence/"+genotyperResult.queryName, function() {
					var epaGenotype = genotyperResult.genotypeFinalClade;
					if(epaGenotype) {
						glue.command(["set", "field", "--noCommit", "epa_genotype_final_clade", epaGenotype]);
						var gtRegex = /AL_([0-9]+)/;
						var gtMatch = gtRegex.exec(epaGenotype);
						if(gtMatch) {
							glue.command(["set", "field", "--noCommit", "epa_genotype", gtMatch[1]]);
						}
					}
					var epaSubtype = genotyperResult.subtypeFinalClade;
					if(epaSubtype) {
						glue.command(["set", "field", "--noCommit", "epa_subtype_final_clade", epaSubtype]);
						var stRegex = /AL_([0-9]+)([a-z]+)/;
						var stMatch = stRegex.exec(epaSubtype);
						if(stMatch) {
							glue.command(["set", "field", "--noCommit", "epa_subtype", stMatch[2]]);
						}
					}
				});
				if(numUpdates % batchSize == 0) {
					glue.command("commit");
					glue.command("new-context");
					glue.log("FINE", "Metadata assigned for "+numUpdates+" sequences.");
				}
				numUpdates++;
			});
			glue.command("commit");
			glue.command("new-context");
			glue.log("FINE", "Metadata assigned for "+numUpdates+" sequences.");
		}
	});
	
}